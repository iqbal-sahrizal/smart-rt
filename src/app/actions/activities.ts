"use server"

import { revalidatePath } from "next/cache"

import { ActivityServiceError } from "@/lib/activities/errors"
import {
  resolveScopedActivityContext,
  type ScopedActivityContext,
} from "@/lib/activities/queries"
import {
  addActivityParticipantWithClient,
  cancelActivityRegistrationWithClient,
  createActivityWithClient,
  recordActivityAttendanceWithClient,
  registerForActivityWithClient,
  removeActivityDocWithClient,
  removeActivityParticipantWithClient,
  softDeleteActivityWithClient,
  transitionActivityStatusWithClient,
  updateActivityWithClient,
  uploadActivityDocWithClient,
} from "@/lib/activities/repository"
import {
  activityUuidSchema,
  addActivityParticipantSchema,
  cancelActivityRegistrationSchema,
  createActivitySchema,
  recordActivityAttendanceSchema,
  registerForActivitySchema,
  removeActivityDocSchema,
  removeActivityParticipantSchema,
  softDeleteActivitySchema,
  transitionActivityStatusSchema,
  updateActivitySchema,
} from "@/lib/activities/schemas"
import { validateActivityDocFile } from "@/lib/activities/storage"
import {
  canManageActivities,
  canOperateActivities,
  canRemoveActivityDoc,
  canTransitionActivityStatus,
  canUploadActivityDoc,
  type ActivityActionErrorCode,
  type ActivityActionResult,
  type ActivityDetail,
  type ActivityParticipant,
  type ActivityScope,
  type AddActivityParticipantInput,
  type CancelActivityRegistrationInput,
  type CancelActivityRegistrationResult,
  type CreateActivityInput,
  type RecordActivityAttendanceInput,
  type RegisterActivityResult,
  type RegisterForActivityInput,
  type RemoveActivityDocInput,
  type RemoveActivityDocResult,
  type RemoveActivityParticipantInput,
  type RemoveActivityParticipantResult,
  type SoftDeleteActivityInput,
  type TransitionActivityStatusInput,
  type UpdateActivityInput,
  type UploadActivityDocResult,
} from "@/lib/activities/types"
import { createClient } from "@/lib/supabase/server"

function revalidateActivityPaths(activityId?: string) {
  revalidatePath("/kegiatan")
  revalidatePath("/activities")
  revalidatePath("/resident/activities")
  revalidatePath("/resident/kegiatan")
  revalidatePath("/resident/layanan")
  revalidatePath("/")
  revalidatePath("/resident")
  if (activityId) {
    revalidatePath(`/kegiatan/${activityId}`)
    revalidatePath(`/activities/${activityId}`)
    revalidatePath(`/resident/activities/${activityId}`)
    revalidatePath(`/resident/kegiatan/${activityId}`)
  }
}

function failAction<T>(
  code: ActivityActionErrorCode,
  error: string,
  fieldErrors?: Record<string, string[] | undefined>
): ActivityActionResult<T> {
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
): ActivityActionResult<T> {
  if (err instanceof ActivityServiceError) {
    return failAction<T>(err.code, err.message)
  }
  return failAction<T>("INTERNAL_ERROR", fallbackMessage)
}

async function requireScopedContext(
  scope: ActivityScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedActivityContext }
  | { ok: false; response: ActivityActionResult<never> }
> {
  const resolved = await resolveScopedActivityContext(scope)
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

export async function createActivityAction(
  input: CreateActivityInput
): Promise<ActivityActionResult<ActivityDetail>> {
  const parsed = createActivitySchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Periksa kembali data kegiatan warga.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan kegiatan warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageActivities(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat membuat kegiatan warga."
    )
  }

  try {
    const supabase = await createClient()
    const detail = await createActivityWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(detail.activity.id)
    return { ok: true, data: detail, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal membuat kegiatan warga. Silakan coba lagi."
    )
  }
}

export async function updateActivityAction(
  input: UpdateActivityInput
): Promise<ActivityActionResult<ActivityDetail>> {
  const parsed = updateActivitySchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Periksa kembali perubahan data kegiatan.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan kegiatan warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageActivities(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat mengubah informasi kegiatan."
    )
  }

  try {
    const supabase = await createClient()
    const detail = await updateActivityWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(detail.activity.id)
    return { ok: true, data: detail, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal memperbarui informasi kegiatan. Silakan coba lagi."
    )
  }
}

export async function transitionActivityStatusAction(
  input: TransitionActivityStatusInput
): Promise<ActivityActionResult<ActivityDetail>> {
  const parsed = transitionActivityStatusSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Parameter perubahan status tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses operasional kegiatan warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canTransitionActivityStatus(tenant.roles, parsed.data.newStatus)) {
    return failAction(
      "FORBIDDEN",
      parsed.data.newStatus === "cancelled"
        ? "Hanya Ketua RT atau Sekretaris yang dapat membatalkan kegiatan."
        : "Role Anda tidak memiliki akses mengubah status kegiatan."
    )
  }

  try {
    const supabase = await createClient()
    const detail = await transitionActivityStatusWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(detail.activity.id)
    return { ok: true, data: detail, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mengubah status kegiatan. Silakan coba lagi."
    )
  }
}

export async function softDeleteActivityAction(
  input: SoftDeleteActivityInput
): Promise<ActivityActionResult<{ activityId: string; deleted: true }>> {
  const parsed = softDeleteActivitySchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Parameter penghapusan tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan kegiatan warga pada workspace ini."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageActivities(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus kegiatan warga."
    )
  }

  try {
    const supabase = await createClient()
    const res = await softDeleteActivityWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(res.activityId)
    return { ok: true, data: res, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menghapus kegiatan warga. Silakan coba lagi."
    )
  }
}

export async function registerForActivityAction(
  input: RegisterForActivityInput
): Promise<ActivityActionResult<RegisterActivityResult>> {
  const parsed = registerForActivitySchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pendaftaran kegiatan tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya warga pada workspace aktif yang dapat mendaftar kegiatan."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const res = await registerForActivityWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      residentId: auth.context.tenant.residentId,
      input: parsed.data,
    })
    revalidateActivityPaths(res.activityId)
    return { ok: true, data: res, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mendaftar kegiatan warga. Silakan coba lagi."
    )
  }
}

export async function cancelActivityRegistrationAction(
  input: CancelActivityRegistrationInput
): Promise<ActivityActionResult<CancelActivityRegistrationResult>> {
  const parsed = cancelActivityRegistrationSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Parameter pembatalan pendaftaran tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "resident",
    "Hanya warga pada workspace aktif yang dapat membatalkan pendaftaran."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const res = await cancelActivityRegistrationWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      residentId: auth.context.tenant.residentId,
      input: parsed.data,
    })
    revalidateActivityPaths(res.activityId)
    return { ok: true, data: res, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal membatalkan pendaftaran kegiatan. Silakan coba lagi."
    )
  }
}

export async function addActivityParticipantAction(
  input: AddActivityParticipantInput
): Promise<ActivityActionResult<ActivityParticipant>> {
  const parsed = addActivityParticipantSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data penambahan peserta tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan peserta kegiatan."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageActivities(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menambahkan peserta kegiatan."
    )
  }

  try {
    const supabase = await createClient()
    const participant = await addActivityParticipantWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(participant.activityId)
    return { ok: true, data: participant, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menambahkan peserta kegiatan. Silakan coba lagi."
    )
  }
}

export async function removeActivityParticipantAction(
  input: RemoveActivityParticipantInput
): Promise<ActivityActionResult<RemoveActivityParticipantResult>> {
  const parsed = removeActivityParticipantSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Parameter penghapusan peserta tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan peserta kegiatan."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canManageActivities(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus peserta dari daftar aktif."
    )
  }

  try {
    const supabase = await createClient()
    const res = await removeActivityParticipantWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(res.activityId)
    return { ok: true, data: res, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menghapus peserta dari daftar aktif. Silakan coba lagi."
    )
  }
}

export async function recordActivityAttendanceAction(
  input: RecordActivityAttendanceInput
): Promise<ActivityActionResult<ActivityParticipant>> {
  const parsed = recordActivityAttendanceSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data presensi kegiatan tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pencatatan presensi kegiatan."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canOperateActivities(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Role Anda tidak memiliki akses mencatat presensi kegiatan."
    )
  }

  try {
    const supabase = await createClient()
    const participant = await recordActivityAttendanceWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(participant.activityId)
    return { ok: true, data: participant, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mencatat presensi kegiatan. Silakan coba lagi."
    )
  }
}

export async function uploadActivityDocAction(
  formData: FormData
): Promise<ActivityActionResult<UploadActivityDocResult>> {
  const rawActivityId = formData.get("activityId")
  const parsedId = activityUuidSchema.safeParse(
    typeof rawActivityId === "string" ? rawActivityId : ""
  )
  if (!parsedId.success) {
    return failAction("VALIDATION_ERROR", "ID kegiatan tidak valid.", {
      activityId: ["Format ID kegiatan tidak valid."],
    })
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengunggahan dokumentasi kegiatan."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canUploadActivityDoc(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Role Anda tidak memiliki akses mengunggah dokumentasi kegiatan."
    )
  }

  const validatedFile = await validateActivityDocFile(formData.get("file"))
  if (!validatedFile.ok) {
    return failAction("VALIDATION_ERROR", validatedFile.error, {
      file: [validatedFile.error],
    })
  }

  try {
    const supabase = await createClient()
    const res = await uploadActivityDocWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      activityId: parsedId.data,
      validatedFile: validatedFile.file,
    })
    revalidateActivityPaths(res.activityId)
    return { ok: true, data: res, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal mengunggah dokumentasi kegiatan. Silakan coba lagi."
    )
  }
}

export async function removeActivityDocAction(
  input: RemoveActivityDocInput
): Promise<ActivityActionResult<RemoveActivityDocResult>> {
  const parsed = removeActivityDocSchema.safeParse(input)
  if (!parsed.success) {
    return failAction(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ??
        "Parameter penghapusan dokumentasi tidak valid.",
      parsed.error.flatten().fieldErrors
    )
  }

  const auth = await requireScopedContext(
    "admin",
    "Anda tidak memiliki akses pengelolaan dokumentasi kegiatan."
  )
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  if (!canRemoveActivityDoc(tenant.roles)) {
    return failAction(
      "FORBIDDEN",
      "Hanya Ketua RT atau Sekretaris yang dapat menghapus dokumentasi kegiatan."
    )
  }

  try {
    const supabase = await createClient()
    const res = await removeActivityDocWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })
    revalidateActivityPaths(res.activityId)
    return { ok: true, data: res, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal menghapus dokumentasi kegiatan. Silakan coba lagi."
    )
  }
}

