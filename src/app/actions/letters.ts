"use server"

import { revalidatePath } from "next/cache"

import {
  LetterServiceError,
} from "@/lib/letters/errors"
import {
  resolveAnyOperationalLetterContext,
  resolveScopedLetterContext,
  type ScopedLetterContext,
} from "@/lib/letters/queries"
import {
  cancelLetterRequestWithClient,
  createLetterRequestWithClient,
  createLetterTypeWithClient,
  deleteLetterTypeWithClient,
  issueLetterWithClient,
  requestRemoveLetterSupportingDocWithClient,
  reviewLetterRequestWithClient,
  updateLetterTypeWithClient,
  uploadLetterSupportingDocWithClient,
} from "@/lib/letters/repository"
import {
  cancelLetterRequestSchema,
  createLetterRequestSchema,
  createLetterTypeSchema,
  deleteLetterTypeSchema,
  letterUuidSchema,
  removeLetterSupportingDocSchema,
  reviewLetterRequestSchema,
  updateLetterTypeSchema,
} from "@/lib/letters/schemas"
import {
  validateIssuedLetterPdfFile,
  validateLetterAttachmentFile,
} from "@/lib/letters/storage"
import {
  canManageLetters,
  type CancelLetterRequestInput,
  type CreateLetterRequestInput,
  type CreateLetterTypeInput,
  type DeleteLetterTypeInput,
  type IssueLetterResult,
  type LetterActionErrorCode,
  type LetterActionResult,
  type LetterRequest,
  type LetterRequestStatus,
  type LetterScope,
  type LetterType,
  type RemoveLetterAttachmentResult,
  type RemoveLetterSupportingDocInput,
  type ReviewLetterRequestInput,
  type UpdateLetterTypeInput,
  type UploadLetterAttachmentResult,
} from "@/lib/letters/types"
import { createClient } from "@/lib/supabase/server"

function revalidateLetterPaths(requestId?: string) {
  revalidatePath("/letters")
  revalidatePath("/surat")
  revalidatePath("/resident/letters")
  revalidatePath("/resident/surat")
  revalidatePath("/")
  revalidatePath("/resident")
  if (requestId) {
    revalidatePath(`/letters/${requestId}`)
    revalidatePath(`/surat/${requestId}`)
    revalidatePath(`/resident/letters/${requestId}`)
    revalidatePath(`/resident/surat/${requestId}`)
  }
}

function failAction<T>(
  code: LetterActionErrorCode,
  error: string,
  fieldErrors?: Record<string, string[] | undefined>
): LetterActionResult<T> {
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
): LetterActionResult<T> {
  if (err instanceof LetterServiceError) {
    return failAction<T>(err.code, err.message)
  }
  return failAction<T>("INTERNAL_ERROR", fallbackMessage)
}

async function requireScopedContext(
  scope: LetterScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedLetterContext }
  | { ok: false; response: LetterActionResult<never> }
> {
  const resolved = await resolveScopedLetterContext(scope)
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

export async function createLetterRequestAction(
  input: CreateLetterRequestInput
): Promise<LetterActionResult<LetterRequest>> {
  const parsed = createLetterRequestSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Periksa kembali jenis surat dan keperluan pengajuan.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya warga pada workspace aktif yang dapat mengajukan surat."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const created = await createLetterRequestWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      memberId: auth.context.tenant.memberId,
      residentId: auth.context.tenant.residentId,
      input: parsed.data,
    })
    revalidateLetterPaths(created.id)
    return { ok: true, data: created, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mengajukan permohonan surat. Silakan coba lagi."
    )
  }
}

export async function uploadLetterSupportingDocAction(
  formData: FormData
): Promise<LetterActionResult<UploadLetterAttachmentResult>> {
  const rawRequestId = formData.get("requestId")
  const parsedId = letterUuidSchema.safeParse(
    typeof rawRequestId === "string" ? rawRequestId : ""
  )
  if (!parsedId.success) {
    return failAction("VALIDATION_ERROR", "ID permohonan surat tidak valid.", {
      requestId: ["Format ID permohonan surat tidak valid."],
    })
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya warga pemohon pada workspace aktif yang dapat mengunggah dokumen pendukung."
  )
  if (!auth.ok) return auth.response

  const validatedFile = await validateLetterAttachmentFile(formData.get("file"))
  if (!validatedFile.ok) {
    return failAction("VALIDATION_ERROR", validatedFile.error, {
      file: [validatedFile.error],
    })
  }

  try {
    const supabase = await createClient()
    const result = await uploadLetterSupportingDocWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      memberId: auth.context.tenant.memberId,
      requestId: parsedId.data,
      validatedFile: validatedFile.file,
    })
    revalidateLetterPaths(result.requestId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mengunggah dokumen pendukung. Silakan coba lagi."
    )
  }
}

export async function removeLetterSupportingDocAction(
  input: RemoveLetterSupportingDocInput
): Promise<LetterActionResult<RemoveLetterAttachmentResult>> {
  const parsed = removeLetterSupportingDocSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Parameter penghapusan dokumen pendukung tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const operational = await resolveAnyOperationalLetterContext()
  if (operational.status === "unauthenticated") {
    return failAction(
      "UNAUTHORIZED",
      "Sesi login Anda telah berakhir. Silakan masuk kembali."
    )
  }
  if (operational.status === "forbidden") {
    return failAction(
      "FORBIDDEN",
      "Anda tidak memiliki akses menghapus dokumen pendukung pada workspace ini."
    )
  }

  const { tenant } = operational.context
  if (operational.scope === "admin" && !canManageLetters(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus lampiran permohonan surat."
    )
  }

  try {
    const supabase = await createClient()
    const result = await requestRemoveLetterSupportingDocWithClient(supabase, {
      tenantId: tenant.tenantId,
      memberId: tenant.memberId,
      roles: tenant.roles,
      scope: operational.scope,
      input: parsed.data,
    })
    revalidateLetterPaths(result.requestId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menghapus dokumen pendukung. Silakan coba lagi."
    )
  }
}

export async function cancelLetterRequestAction(
  input: CancelLetterRequestInput
): Promise<LetterActionResult<{ requestId: string; status: "cancelled" }>> {
  const parsed = cancelLetterRequestSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "Parameter pembatalan permohonan surat tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya warga pemohon pada workspace aktif yang dapat membatalkan permohonan surat."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await cancelLetterRequestWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      memberId: auth.context.tenant.memberId,
      input: parsed.data,
    })
    revalidateLetterPaths(result.requestId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal membatalkan permohonan surat. Silakan coba lagi."
    )
  }
}

export async function reviewLetterRequestAction(
  input: ReviewLetterRequestInput
): Promise<LetterActionResult<{ requestId: string; status: LetterRequestStatus }>> {
  const parsed = reviewLetterRequestSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Periksa kembali keputusan peninjauan dan catatan pengurus.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelola surat pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageLetters(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat meninjau permohonan surat."
    )
  }

  try {
    const supabase = await createClient()
    const result = await reviewLetterRequestWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateLetterPaths(result.requestId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal memperbarui status peninjauan surat. Silakan coba lagi."
    )
  }
}

export async function issueLetterAction(
  formData: FormData
): Promise<LetterActionResult<IssueLetterResult>> {
  const rawRequestId = formData.get("requestId")
  const parsedId = letterUuidSchema.safeParse(
    typeof rawRequestId === "string" ? rawRequestId : ""
  )
  if (!parsedId.success) {
    return failAction("VALIDATION_ERROR", "ID permohonan surat tidak valid.", {
      requestId: ["Format ID permohonan surat tidak valid."],
    })
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses penerbitan surat pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageLetters(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menerbitkan surat."
    )
  }

  const validatedFile = await validateIssuedLetterPdfFile(formData.get("file"))
  if (!validatedFile.ok) {
    return failAction("VALIDATION_ERROR", validatedFile.error, {
      file: [validatedFile.error],
    })
  }

  try {
    const supabase = await createClient()
    const result = await issueLetterWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      requestId: parsedId.data,
      validatedFile: validatedFile.file,
    })
    revalidateLetterPaths(result.requestId)
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menerbitkan surat. Silakan coba lagi."
    )
  }
}

export async function createLetterTypeAction(
  input: CreateLetterTypeInput
): Promise<LetterActionResult<LetterType>> {
  const parsed = createLetterTypeSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Periksa kembali data jenis surat.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan jenis surat pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageLetters(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menambah jenis surat."
    )
  }

  try {
    const supabase = await createClient()
    const created = await createLetterTypeWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateLetterPaths()
    return { ok: true, data: created, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal membuat jenis surat baru. Silakan coba lagi."
    )
  }
}

export async function updateLetterTypeAction(
  input: UpdateLetterTypeInput
): Promise<LetterActionResult<LetterType>> {
  const parsed = updateLetterTypeSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Periksa kembali pembaruan jenis surat.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan jenis surat pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageLetters(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat mengubah jenis surat."
    )
  }

  try {
    const supabase = await createClient()
    const updated = await updateLetterTypeWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateLetterPaths()
    return { ok: true, data: updated, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal memperbarui jenis surat. Silakan coba lagi."
    )
  }
}

export async function deleteLetterTypeAction(
  input: DeleteLetterTypeInput
): Promise<LetterActionResult<{ letterTypeId: string; deleted: true }>> {
  const parsed = deleteLetterTypeSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      "ID jenis surat tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan jenis surat pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageLetters(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus jenis surat."
    )
  }

  try {
    const supabase = await createClient()
    const deleted = await deleteLetterTypeWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateLetterPaths()
    return { ok: true, data: deleted, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menghapus jenis surat. Silakan coba lagi."
    )
  }
}

