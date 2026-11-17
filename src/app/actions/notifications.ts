"use server"

import { revalidatePath } from "next/cache"

import { resolveScopedNotificationContext } from "@/lib/notifications/queries"
import {
  markAllNotificationsReadSchema,
  markNotificationReadSchema,
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
} from "@/lib/notifications/schemas"
import type {
  NotificationMutationResult,
  NotificationScope,
} from "@/lib/notifications/types"
import { createClient } from "@/lib/supabase/server"

function getCenterPath(scope: NotificationScope): string {
  return scope === "admin" ? "/notifications" : "/resident/notifications"
}

export async function markNotificationAsReadAction(input: {
  notificationId: string
  scope: NotificationScope
}): Promise<NotificationMutationResult> {
  const parsed = markNotificationReadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: "Parameter notifikasi tidak valid.",
    }
  }

  const { notificationId, scope } = parsed.data
  const resolved = await resolveScopedNotificationContext(scope)

  if (resolved.status === "unauthenticated") {
    return { ok: false, error: "Sesi login Anda telah berakhir." }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      error: "Anda tidak memiliki akses ke notifikasi pada workspace ini.",
    }
  }

  const { ctx, tenant } = resolved.context
  const supabase = await createClient()

  const { data: existing, error: fetchError } = await supabase
    .from("notifications")
    .select("id, is_read, read_at")
    .eq("id", notificationId)
    .eq("tenant_id", tenant.tenantId)
    .eq("recipient_user_id", ctx.user.id)
    .maybeSingle()

  if (fetchError) {
    return {
      ok: false,
      error: "Gagal memeriksa status notifikasi.",
    }
  }

  if (!existing) {
    return {
      ok: false,
      error: "Notifikasi tidak ditemukan atau tidak termasuk dalam akses Anda.",
    }
  }

  const existingRow = existing as {
    id: string
    is_read: boolean
    read_at: string | null
  }

  if (existingRow.is_read) {
    return {
      ok: true,
      error: null,
      updatedCount: 0,
      readAt: existingRow.read_at,
    }
  }

  const nowIso = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from("notifications")
    .update({
      is_read: true,
      read_at: nowIso,
    })
    .eq("id", notificationId)
    .eq("tenant_id", tenant.tenantId)
    .eq("recipient_user_id", ctx.user.id)
    .eq("is_read", false)
    .select("id, read_at")
    .maybeSingle()

  if (updateError) {
    return {
      ok: false,
      error: "Gagal menandai notifikasi sebagai sudah dibaca.",
    }
  }

  revalidatePath(getCenterPath(scope))

  const updatedRow = updated as { id: string; read_at: string | null } | null
  return {
    ok: true,
    error: null,
    updatedCount: updatedRow ? 1 : 0,
    readAt: updatedRow?.read_at ?? nowIso,
  }
}

export async function markAllNotificationsAsReadAction(input: {
  scope: NotificationScope
}): Promise<NotificationMutationResult> {
  const parsed = markAllNotificationsReadSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: "Permintaan notifikasi tidak valid.",
    }
  }

  const { scope } = parsed.data
  const resolved = await resolveScopedNotificationContext(scope)

  if (resolved.status === "unauthenticated") {
    return { ok: false, error: "Sesi login Anda telah berakhir." }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      error: "Anda tidak memiliki akses ke notifikasi pada workspace ini.",
    }
  }

  const { ctx, tenant } = resolved.context
  const supabase = await createClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from("notifications")
    .update({
      is_read: true,
      read_at: nowIso,
    })
    .eq("tenant_id", tenant.tenantId)
    .eq("recipient_user_id", ctx.user.id)
    .eq("is_read", false)
    .select("id")

  if (error) {
    return {
      ok: false,
      error: "Gagal menandai semua notifikasi sebagai sudah dibaca.",
    }
  }

  revalidatePath(getCenterPath(scope))

  return {
    ok: true,
    error: null,
    updatedCount: data?.length ?? 0,
    readAt: nowIso,
  }
}

export async function registerDeviceTokenAction(input: {
  fcmToken: string
  platform?: "android" | "ios" | "web"
  deviceInfo?: Record<string, unknown>
}): Promise<{ ok: boolean; error: string | null }> {
  const parsed = registerDeviceTokenSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "Parameter token tidak valid." }
  }

  let resolved = await resolveScopedNotificationContext("resident")
  if (resolved.status !== "ok") {
    resolved = await resolveScopedNotificationContext("admin")
    if (resolved.status !== "ok") {
      return { ok: false, error: "Sesi login tidak aktif." }
    }
  }

  const { tenant } = resolved.context
  const supabase = await createClient()
  const { error } = await supabase.rpc("register_device_token", {
    p_tenant_id: tenant.tenantId,
    p_fcm_token: parsed.data.fcmToken,
    p_platform: parsed.data.platform,
    p_device_info: parsed.data.deviceInfo,
  })

  if (error) {
    console.error("[registerDeviceTokenAction] RPC error:", error)
    return { ok: false, error: "Gagal mendaftarkan token perangkat." }
  }

  return { ok: true, error: null }
}

export async function unregisterDeviceTokenAction(input: {
  fcmToken: string
}): Promise<{ ok: boolean; error: string | null }> {
  const parsed = unregisterDeviceTokenSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "Parameter token tidak valid." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("unregister_device_token", {
    p_fcm_token: parsed.data.fcmToken,
  })

  if (error) {
    console.error("[unregisterDeviceTokenAction] RPC error:", error)
    return { ok: false, error: "Gagal menonaktifkan token perangkat." }
  }

  return { ok: true, error: null }
}

