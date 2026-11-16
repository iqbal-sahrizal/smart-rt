"use server"

import { revalidatePath } from "next/cache"

import { resolveScopedRondaContext } from "@/lib/ronda/queries"
import {
  RondaServiceError,
  deleteRondaScheduleWithClient,
  recordRondaAttendanceWithClient,
  upsertRondaScheduleWithClient,
} from "@/lib/ronda/repository"
import {
  deleteRondaScheduleSchema,
  recordRondaAttendanceSchema,
  upsertRondaScheduleSchema,
} from "@/lib/ronda/schemas"
import {
  canManageRonda,
  type DeleteRondaScheduleResult,
  type RecordRondaAttendanceResult,
  type RondaActionResult,
  type RondaAttendanceInput,
  type RondaScheduleInput,
  type UpsertRondaScheduleResult,
} from "@/lib/ronda/types"
import { createClient } from "@/lib/supabase/server"

function revalidateRondaPaths(scheduleId?: string) {
  revalidatePath("/ronda")
  revalidatePath("/resident/ronda")
  revalidatePath("/")
  revalidatePath("/resident")
  if (scheduleId) {
    revalidatePath(`/ronda/${scheduleId}`)
    revalidatePath(`/resident/ronda/${scheduleId}`)
  }
}

export async function upsertRondaScheduleAction(
  input: RondaScheduleInput
): Promise<RondaActionResult<UpsertRondaScheduleResult>> {
  const parsed = upsertRondaScheduleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      data: null,
      error: "Periksa kembali isian jadwal dan daftar petugas ronda.",
      code: "VALIDATION_ERROR",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const resolved = await resolveScopedRondaContext("admin")
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      data: null,
      error: "Sesi login Anda telah berakhir. Silakan masuk kembali.",
      code: "UNAUTHORIZED",
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      data: null,
      error: "Anda tidak memiliki akses pengelola pada workspace ini.",
      code: "FORBIDDEN",
    }
  }

  const { tenant } = resolved.context
  if (!canManageRonda(tenant.roles)) {
    return {
      ok: false,
      data: null,
      error:
        "Hanya Ketua RT atau Sekretaris yang berwenang membuat atau mengubah jadwal ronda.",
      code: "FORBIDDEN",
    }
  }

  try {
    const supabase = await createClient()
    const result = await upsertRondaScheduleWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      input: parsed.data,
    })

    revalidateRondaPaths(result.id)
    return {
      ok: true,
      data: result,
      error: null,
    }
  } catch (err) {
    if (err instanceof RondaServiceError) {
      return {
        ok: false,
        data: null,
        error: err.message,
        code: err.code,
      }
    }
    return {
      ok: false,
      data: null,
      error: "Gagal menyimpan jadwal ronda. Silakan coba lagi.",
      code: "INTERNAL_ERROR",
    }
  }
}

export async function deleteRondaScheduleAction(input: {
  scheduleId: string
}): Promise<RondaActionResult<DeleteRondaScheduleResult>> {
  const parsed = deleteRondaScheduleSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      data: null,
      error: "ID jadwal ronda tidak valid.",
      code: "VALIDATION_ERROR",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const resolved = await resolveScopedRondaContext("admin")
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      data: null,
      error: "Sesi login Anda telah berakhir. Silakan masuk kembali.",
      code: "UNAUTHORIZED",
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      data: null,
      error: "Anda tidak memiliki akses pengelola pada workspace ini.",
      code: "FORBIDDEN",
    }
  }

  const { tenant } = resolved.context
  if (!canManageRonda(tenant.roles)) {
    return {
      ok: false,
      data: null,
      error:
        "Hanya Ketua RT atau Sekretaris yang berwenang menghapus jadwal ronda.",
      code: "FORBIDDEN",
    }
  }

  try {
    const supabase = await createClient()
    const result = await deleteRondaScheduleWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      scheduleId: parsed.data.scheduleId,
    })

    revalidateRondaPaths(result.id)
    return {
      ok: true,
      data: result,
      error: null,
    }
  } catch (err) {
    if (err instanceof RondaServiceError) {
      return {
        ok: false,
        data: null,
        error: err.message,
        code: err.code,
      }
    }
    return {
      ok: false,
      data: null,
      error: "Gagal menghapus jadwal ronda. Silakan coba lagi.",
      code: "INTERNAL_ERROR",
    }
  }
}

export async function recordRondaAttendanceAction(
  input: RondaAttendanceInput
): Promise<RondaActionResult<RecordRondaAttendanceResult>> {
  const parsed = recordRondaAttendanceSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      data: null,
      error: "Data pencatatan kehadiran ronda tidak valid.",
      code: "VALIDATION_ERROR",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const resolved = await resolveScopedRondaContext("admin")
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      data: null,
      error: "Sesi login Anda telah berakhir. Silakan masuk kembali.",
      code: "UNAUTHORIZED",
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      data: null,
      error: "Anda tidak memiliki akses pengelola pada workspace ini.",
      code: "FORBIDDEN",
    }
  }

  const { tenant } = resolved.context
  if (!canManageRonda(tenant.roles)) {
    return {
      ok: false,
      data: null,
      error:
        "Hanya Ketua RT atau Sekretaris yang berwenang mencatat kehadiran ronda.",
      code: "FORBIDDEN",
    }
  }

  try {
    const supabase = await createClient()
    const result = await recordRondaAttendanceWithClient(supabase, {
      tenantId: tenant.tenantId,
      roles: tenant.roles,
      assignmentId: parsed.data.assignmentId,
      attendanceStatus: parsed.data.attendanceStatus,
      attendanceNotes: parsed.data.attendanceNotes,
    })

    revalidateRondaPaths(result.scheduleId)
    return {
      ok: true,
      data: result,
      error: null,
    }
  } catch (err) {
    if (err instanceof RondaServiceError) {
      return {
        ok: false,
        data: null,
        error: err.message,
        code: err.code,
      }
    }
    return {
      ok: false,
      data: null,
      error: "Gagal menyimpan status kehadiran ronda. Silakan coba lagi.",
      code: "INTERNAL_ERROR",
    }
  }
}

