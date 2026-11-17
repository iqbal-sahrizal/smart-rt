"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireAdminContext } from "@/lib/auth/guards"
import {
  createAnnouncementSchema,
  deleteAnnouncementSchema,
  updateAnnouncementSchema,
} from "@/lib/announcements/schemas"
import {
  canManageAnnouncements,
  type AnnouncementFormActionState,
  type AnnouncementStatus,
  type AnnouncementTargetType,
} from "@/lib/announcements/types"
import { createClient } from "@/lib/supabase/server"
import { invokeNotificationEnqueueRpc } from "@/lib/notifications/enqueue-rpc"

function getStringField(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

function getStringArrayField(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((v): v is string => typeof v === "string")
}

async function verifyRecipientTargets({
  supabase,
  tenantId,
  targetType,
  roleIds,
  householdIds,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  tenantId: string
  targetType: AnnouncementTargetType
  roleIds: string[]
  householdIds: string[]
}): Promise<{ ok: true } | { ok: false; state: AnnouncementFormActionState }> {
  if (targetType === "role") {
    const { data: foundRoles } = await supabase
      .from("roles")
      .select("id")
      .in("id", roleIds)
    const foundSet = new Set((foundRoles ?? []).map((r) => (r as { id: string }).id))
    if (roleIds.some((id) => !foundSet.has(id))) {
      return {
        ok: false,
        state: {
          error: "Terdapat peran penerima yang tidak valid.",
          fieldErrors: {
            recipientRoleIds: ["Pilih peran penerima yang valid."],
          },
        },
      }
    }
  }

  if (targetType === "household") {
    const { data: foundHouseholds } = await supabase
      .from("households")
      .select("id")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("id", householdIds)
    const foundSet = new Set(
      (foundHouseholds ?? []).map((h) => (h as { id: string }).id)
    )
    if (householdIds.some((id) => !foundSet.has(id))) {
      return {
        ok: false,
        state: {
          error: "Sebagian Kartu Keluarga penerima tidak ditemukan pada RT ini.",
          fieldErrors: {
            recipientHouseholdIds: [
              "Pilih Kartu Keluarga yang terdaftar aktif pada RT ini.",
            ],
          },
        },
      }
    }
  }

  return { ok: true }
}

interface AnnouncementRecipientInsertRow {
  tenant_id: string
  announcement_id: string
  role_id: string | null
  household_id: string | null
}

function buildRecipientInsertRows({
  tenantId,
  announcementId,
  targetType,
  roleIds,
  householdIds,
}: {
  tenantId: string
  announcementId: string
  targetType: AnnouncementTargetType
  roleIds: string[]
  householdIds: string[]
}): AnnouncementRecipientInsertRow[] {
  if (targetType === "role") {
    return roleIds.map((roleId) => ({
      tenant_id: tenantId,
      announcement_id: announcementId,
      role_id: roleId,
      household_id: null,
    }))
  }
  if (targetType === "household") {
    return householdIds.map((householdId) => ({
      tenant_id: tenantId,
      announcement_id: announcementId,
      role_id: null,
      household_id: householdId,
    }))
  }
  return []
}

export async function createAnnouncementAction(
  _prevState: AnnouncementFormActionState,
  formData: FormData
): Promise<AnnouncementFormActionState> {
  const { ctx, tenant } = await requireAdminContext()

  if (!canManageAnnouncements(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk membuat pengumuman. Hanya Ketua RT, Sekretaris, atau Pengurus yang diizinkan.",
    }
  }

  const parsed = createAnnouncementSchema.safeParse({
    title: getStringField(formData, "title"),
    content: getStringField(formData, "content"),
    status: getStringField(formData, "status") || "draft",
    targetType: getStringField(formData, "targetType") || "all",
    recipientRoleIds: getStringArrayField(formData, "recipientRoleIds"),
    recipientHouseholdIds: getStringArrayField(
      formData,
      "recipientHouseholdIds"
    ),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali isian pengumuman yang masih belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const targetCheck = await verifyRecipientTargets({
    supabase,
    tenantId: tenant.tenantId,
    targetType: input.targetType,
    roleIds: input.recipientRoleIds,
    householdIds: input.recipientHouseholdIds,
  })
  if (!targetCheck.ok) {
    return targetCheck.state
  }

  const publishedAt =
    input.status === "published" ? new Date().toISOString() : null

  const { data: created, error: insertError } = await supabase
    .from("announcements")
    .insert({
      tenant_id: tenant.tenantId,
      author_id: ctx.user.id,
      title: input.title,
      content: input.content,
      status: input.status,
      target_type: input.targetType,
      published_at: publishedAt,
    })
    .select("id")
    .single()

  if (insertError || !created) {
    return {
      error:
        insertError?.code === "42501"
          ? "Anda tidak memiliki izin database untuk membuat pengumuman."
          : "Gagal menyimpan pengumuman baru. Silakan coba lagi.",
    }
  }

  const announcementId = (created as { id: string }).id
  const recipientRows = buildRecipientInsertRows({
    tenantId: tenant.tenantId,
    announcementId,
    targetType: input.targetType,
    roleIds: input.recipientRoleIds,
    householdIds: input.recipientHouseholdIds,
  })

  if (recipientRows.length > 0) {
    const { error: recipientError } = await supabase
      .from("announcement_recipients")
      .insert(recipientRows)

    if (recipientError) {
      await supabase
        .from("announcements")
        .delete()
        .eq("id", announcementId)
        .eq("tenant_id", tenant.tenantId)

      return {
        error:
          "Gagal menetapkan daftar penerima pengumuman. Penyimpanan dibatalkan agar data tetap konsisten.",
      }
    }
  }

  if (input.status === "published") {
    await invokeNotificationEnqueueRpc(supabase, "notify_announcement_published", {
      p_announcement_id: announcementId,
    })
  }

  revalidatePath("/announcements")
  revalidatePath("/resident/announcements")
  revalidatePath("/")
  revalidatePath("/resident")
  redirect(`/announcements/${announcementId}?created=1`)
}

export async function updateAnnouncementAction(
  _prevState: AnnouncementFormActionState,
  formData: FormData
): Promise<AnnouncementFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageAnnouncements(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk mengubah pengumuman. Hanya Ketua RT, Sekretaris, atau Pengurus yang diizinkan.",
    }
  }

  const parsed = updateAnnouncementSchema.safeParse({
    announcementId: getStringField(formData, "announcementId"),
    title: getStringField(formData, "title"),
    content: getStringField(formData, "content"),
    status: getStringField(formData, "status"),
    targetType: getStringField(formData, "targetType"),
    recipientRoleIds: getStringArrayField(formData, "recipientRoleIds"),
    recipientHouseholdIds: getStringArrayField(
      formData,
      "recipientHouseholdIds"
    ),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali isian pengumuman yang masih belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: existingRow } = await supabase
    .from("announcements")
    .select("id, title, content, status, target_type, published_at")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.announcementId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!existingRow) {
    return {
      error: "Pengumuman tidak ditemukan atau sudah dihapus.",
    }
  }

  const existing = existingRow as {
    id: string
    title: string
    content: string
    status: AnnouncementStatus
    target_type: AnnouncementTargetType
    published_at: string | null
  }

  const targetCheck = await verifyRecipientTargets({
    supabase,
    tenantId: tenant.tenantId,
    targetType: input.targetType,
    roleIds: input.recipientRoleIds,
    householdIds: input.recipientHouseholdIds,
  })
  if (!targetCheck.ok) {
    return targetCheck.state
  }

  const { data: prevRecipientsRows } = await supabase
    .from("announcement_recipients")
    .select("role_id, household_id")
    .eq("tenant_id", tenant.tenantId)
    .eq("announcement_id", existing.id)

  const previousRecipients = (
    (prevRecipientsRows ?? []) as Array<{
      role_id: string | null
      household_id: string | null
    }>
  ).map((r) => ({
    tenant_id: tenant.tenantId,
    announcement_id: existing.id,
    role_id: r.role_id,
    household_id: r.household_id,
  }))

  // Clear existing recipients BEFORE updating target_type to satisfy trg_announcements_validate_target_change.
  if (previousRecipients.length > 0) {
    const { error: clearErr } = await supabase
      .from("announcement_recipients")
      .delete()
      .eq("tenant_id", tenant.tenantId)
      .eq("announcement_id", existing.id)

    if (clearErr) {
      return {
        error: "Gagal memperbarui target penerima pengumuman.",
      }
    }
  }

  const nextPublishedAt =
    input.status === "published"
      ? existing.published_at ?? new Date().toISOString()
      : input.status === "draft"
        ? null
        : existing.published_at

  const { error: updateErr } = await supabase
    .from("announcements")
    .update({
      title: input.title,
      content: input.content,
      status: input.status,
      target_type: input.targetType,
      published_at: nextPublishedAt,
    })
    .eq("id", existing.id)
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)

  if (updateErr) {
    if (previousRecipients.length > 0) {
      await supabase.from("announcement_recipients").insert(previousRecipients)
    }
    return {
      error: "Gagal menyimpan perubahan pengumuman. Silakan coba lagi.",
    }
  }

  const nextRecipientRows = buildRecipientInsertRows({
    tenantId: tenant.tenantId,
    announcementId: existing.id,
    targetType: input.targetType,
    roleIds: input.recipientRoleIds,
    householdIds: input.recipientHouseholdIds,
  })

  if (nextRecipientRows.length > 0) {
    const { error: insertRecErr } = await supabase
      .from("announcement_recipients")
      .insert(nextRecipientRows)

    if (insertRecErr) {
      await supabase
        .from("announcements")
        .update({
          title: existing.title,
          content: existing.content,
          status: existing.status,
          target_type: existing.target_type,
          published_at: existing.published_at,
        })
        .eq("id", existing.id)
        .eq("tenant_id", tenant.tenantId)

      if (previousRecipients.length > 0) {
        await supabase.from("announcement_recipients").insert(previousRecipients)
      }

      return {
        error:
          "Gagal memperbarui daftar penerima pengumuman. Perubahan sebelumnya dipulihkan.",
      }
    }
  }

  if (input.status === "published") {
    await invokeNotificationEnqueueRpc(supabase, "notify_announcement_published", {
      p_announcement_id: existing.id,
    })
  }

  revalidatePath("/announcements")
  revalidatePath(`/announcements/${existing.id}`)
  revalidatePath("/resident/announcements")
  revalidatePath("/")
  revalidatePath("/resident")
  redirect(`/announcements/${existing.id}?updated=1`)
}

export async function deleteAnnouncementAction(
  formData: FormData
): Promise<AnnouncementFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageAnnouncements(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk menghapus pengumuman. Hanya Ketua RT, Sekretaris, atau Pengurus yang diizinkan.",
    }
  }

  const parsed = deleteAnnouncementSchema.safeParse({
    announcementId: getStringField(formData, "announcementId"),
  })

  if (!parsed.success) {
    return {
      error: "ID pengumuman tidak valid.",
    }
  }

  const { announcementId } = parsed.data
  const supabase = await createClient()

  const { data: existingRow } = await supabase
    .from("announcements")
    .select("id, attachment_path")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", announcementId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!existingRow) {
    return {
      error: "Pengumuman tidak ditemukan atau sudah dihapus.",
    }
  }

  const existing = existingRow as { id: string; attachment_path: string | null }

  if (!existing.attachment_path) {
    const { error: delErr } = await supabase
      .from("announcements")
      .delete()
      .eq("id", announcementId)
      .eq("tenant_id", tenant.tenantId)

    if (delErr) {
      return {
        error: "Gagal menghapus pengumuman. Silakan coba lagi.",
      }
    }
  } else {
    const { error: softErr } = await supabase
      .from("announcements")
      .update({
        deleted_at: new Date().toISOString(),
        status: "archived",
      })
      .eq("id", announcementId)
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)

    if (softErr) {
      return {
        error: "Gagal mengarsipkan pengumuman. Silakan coba lagi.",
      }
    }
  }

  revalidatePath("/announcements")
  revalidatePath("/resident/announcements")
  revalidatePath("/")
  revalidatePath("/resident")
  redirect("/announcements?deleted=1")
}
