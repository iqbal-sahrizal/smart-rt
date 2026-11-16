"use server"

import { revalidatePath } from "next/cache"

import {
  resolveAnyOperationalComplaintContext,
  resolveScopedComplaintContext,
  type ScopedComplaintContext,
} from "@/lib/complaints/queries"
import {
  ComplaintServiceError,
  createComplaintReplyWithClient,
  createComplaintWithClient,
  requestDeleteComplaintPhotoWithClient,
  softDeleteComplaintWithClient,
  transitionComplaintStatusWithClient,
  updateComplaintWithClient,
  uploadComplaintPhotoWithClient,
} from "@/lib/complaints/repository"
import {
  complaintUuidSchema,
  createComplaintReplySchema,
  createComplaintSchema,
  deleteComplaintPhotoSchema,
  softDeleteComplaintSchema,
  transitionComplaintStatusSchema,
  updateComplaintSchema,
} from "@/lib/complaints/schemas"
import { validateComplaintPhotoFile } from "@/lib/complaints/storage"
import {
  canManageComplaints,
  type Complaint,
  type ComplaintActionErrorCode,
  type ComplaintActionResult,
  type ComplaintReply,
  type ComplaintScope,
  type ComplaintStatus,
  type CreateComplaintInput,
  type CreateComplaintReplyInput,
  type DeleteComplaintPhotoInput,
  type DeleteComplaintPhotoResult,
  type SoftDeleteComplaintInput,
  type TransitionComplaintStatusInput,
  type UpdateComplaintInput,
  type UploadComplaintPhotoResult,
} from "@/lib/complaints/types"
import { createClient } from "@/lib/supabase/server"

function revalidateComplaintPaths(complaintId?: string) {
  revalidatePath("/complaints")
  revalidatePath("/resident/complaints")
  revalidatePath("/")
  revalidatePath("/resident")
  if (complaintId) {
    revalidatePath(`/complaints/${complaintId}`)
    revalidatePath(`/resident/complaints/${complaintId}`)
  }
}

function failAction<T>(
  code: ComplaintActionErrorCode,
  error: string,
  fieldErrors?: Record<string, string[] | undefined>
): ComplaintActionResult<T> {
  return {
    ok: false,
    data: null,
    error,
    code,
    ...(fieldErrors ? { fieldErrors } : {}),
  }
}

function mapActionException<T>(
  err: unknown,
  fallbackMessage: string
): ComplaintActionResult<T> {
  if (err instanceof ComplaintServiceError) {
    return failAction<T>(err.code, err.message)
  }
  return failAction<T>("INTERNAL_ERROR", fallbackMessage)
}

async function requireScopedContext(
  scope: ComplaintScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedComplaintContext }
  | { ok: false; response: ComplaintActionResult<never> }
> {
  const resolved = await resolveScopedComplaintContext(scope)
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: failAction(
        "UNAUTHORIZED",
        "Sesi login Anda telah berakhir. Silakan masuk kembali."
      ),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: failAction("FORBIDDEN", forbiddenMessage),
    }
  }
  return { ok: true, context: resolved.context }
}

export async function createComplaintAction(
  input: CreateComplaintInput
): Promise<ComplaintActionResult<Complaint>> {
  const parsed = createComplaintSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Periksa kembali kategori, judul, dan deskripsi pengaduan.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya warga pada workspace aktif yang dapat membuat pengaduan."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const created = await createComplaintWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      memberId: auth.context.tenant.memberId,
      input: parsed.data,
    })
    revalidateComplaintPaths(created.id)
    return { ok: true, data: created, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal mengirim pengaduan. Silakan coba lagi.")
  }
}

export async function updateComplaintAction(
  input: UpdateComplaintInput
): Promise<ComplaintActionResult<Complaint>> {
  const parsed = updateComplaintSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Periksa kembali pembaruan pengaduan Anda.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya pelapor di portal warga yang dapat mengubah pengaduan."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const updated = await updateComplaintWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      memberId: auth.context.tenant.memberId,
      input: parsed.data,
    })
    revalidateComplaintPaths(updated.id)
    return { ok: true, data: updated, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal memperbarui pengaduan. Silakan coba lagi."
    )
  }
}

export async function createComplaintReplyAction(
  input: CreateComplaintReplyInput
): Promise<ComplaintActionResult<ComplaintReply>> {
  const parsed = createComplaintReplySchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Periksa kembali pesan balasan pengaduan.",
      parsed.error.flatten().fieldErrors
    )
  }

  const operational = await resolveAnyOperationalComplaintContext()
  if (operational.status === "unauthenticated") {
    return failAction(
      "UNAUTHORIZED",
      "Sesi login Anda telah berakhir. Silakan masuk kembali."
    )
  }
  if (operational.status === "forbidden") {
    return failAction(
      "FORBIDDEN",
      "Anda tidak memiliki akses untuk membalas pengaduan pada workspace ini."
    )
  }

  if (parsed.data.scope && parsed.data.scope !== operational.scope) {
    return failAction(
      "FORBIDDEN",
      "Workspace aktif tidak sesuai dengan lingkup balasan."
    )
  }

  const { tenant } = operational.context
  if (operational.scope === "admin" && !canManageComplaints(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat membalas pengaduan."
    )
  }

  try {
    const supabase = await createClient()
    const reply = await createComplaintReplyWithClient(supabase, {
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      roles: tenant.roles,
      scope: operational.scope,
      input: parsed.data,
    })
    revalidateComplaintPaths(reply.complaintId)
    return { ok: true, data: reply, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mengirim balasan pengaduan. Silakan coba lagi."
    )
  }
}

export async function transitionComplaintStatusAction(
  input: TransitionComplaintStatusInput
): Promise<
  ComplaintActionResult<{ complaintId: string; newStatus: ComplaintStatus }>
> {
  const parsed = transitionComplaintStatusSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Periksa kembali status tujuan dan alasan perubahan status.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelola pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageComplaints(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat mengubah status pengaduan."
    )
  }

  try {
    const supabase = await createClient()
    const result = await transitionComplaintStatusWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateComplaintPaths(result.complaintId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal memperbarui status pengaduan. Silakan coba lagi."
    )
  }
}

export async function softDeleteComplaintAction(
  input: SoftDeleteComplaintInput
): Promise<ComplaintActionResult<{ complaintId: string; deleted: true }>> {
  const parsed = softDeleteComplaintSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Alasan penghapusan pengaduan wajib diisi (3–500 karakter).",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelola pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageComplaints(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat menghapus pengaduan."
    )
  }

  try {
    const supabase = await createClient()
    const result = await softDeleteComplaintWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateComplaintPaths(result.complaintId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menghapus pengaduan. Silakan coba lagi."
    )
  }
}

export async function uploadComplaintPhotoAction(
  formData: FormData
): Promise<ComplaintActionResult<UploadComplaintPhotoResult>> {
  const rawComplaintId = formData.get("complaintId")
  const parsedId = complaintUuidSchema.safeParse(
    typeof rawComplaintId === "string" ? rawComplaintId : ""
  )
  if (!parsedId.success) {
    return failAction(
      "VALIDATION_ERROR",
      "ID pengaduan tidak valid.",
      { complaintId: ["Format ID pengaduan tidak valid."] }
    )
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya warga pelapor pada workspace aktif yang dapat mengunggah foto pengaduan."
  )
  if (!auth.ok) return auth.response

  const validatedFile = await validateComplaintPhotoFile(formData.get("photo"))
  if (!validatedFile.ok) {
    return failAction("VALIDATION_ERROR", validatedFile.error, {
      photo: [validatedFile.error],
    })
  }

  try {
    const supabase = await createClient()
    const result = await uploadComplaintPhotoWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      memberId: auth.context.tenant.memberId,
      complaintId: parsedId.data,
      validatedFile: validatedFile.file,
    })
    revalidateComplaintPaths(result.complaintId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mengunggah foto pengaduan. Silakan coba lagi."
    )
  }
}

export async function deleteComplaintPhotoAction(
  input: DeleteComplaintPhotoInput
): Promise<ComplaintActionResult<DeleteComplaintPhotoResult>> {
  const parsed = deleteComplaintPhotoSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Parameter penghapusan foto pengaduan tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const operational = await resolveAnyOperationalComplaintContext()
  if (operational.status === "unauthenticated") {
    return failAction(
      "UNAUTHORIZED",
      "Sesi login Anda telah berakhir. Silakan masuk kembali."
    )
  }
  if (operational.status === "forbidden") {
    return failAction(
      "FORBIDDEN",
      "Anda tidak memiliki akses menghapus foto pengaduan pada workspace ini."
    )
  }

  const { tenant } = operational.context
  if (operational.scope === "admin" && !canManageComplaints(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Bendahara tidak berhak menghapus foto pengaduan."
    )
  }

  try {
    const supabase = await createClient()
    const result = await requestDeleteComplaintPhotoWithClient(supabase, {
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      roles: tenant.roles,
      scope: operational.scope,
      input: parsed.data,
    })
    revalidateComplaintPaths(parsed.data.complaintId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menghapus foto pengaduan. Silakan coba lagi."
    )
  }
}

