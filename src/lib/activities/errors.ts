import type { ActivityActionErrorCode } from "@/lib/activities/types"

export class ActivityServiceError extends Error {
  readonly status: number
  readonly code: ActivityActionErrorCode

  constructor(status: number, code: ActivityActionErrorCode, message: string) {
    super(message)
    this.name = "ActivityServiceError"
    this.status = status
    this.code = code
  }
}

export interface DbErrorLike {
  code?: string | null
  message?: string | null
}

export type ActivityErrorOperation =
  | "create"
  | "update"
  | "transition"
  | "soft_delete"
  | "register"
  | "cancel_registration"
  | "add_participant"
  | "remove_participant"
  | "attendance"
  | "attach_doc"
  | "remove_doc"
  | "read"

export function mapActivityDbError(
  error: DbErrorLike,
  context?: { operation?: ActivityErrorOperation }
): ActivityServiceError {
  const code = error.code ?? ""
  const lower = (error.message ?? "").toLowerCase()

  if (lower.includes("unauthenticated")) {
    return new ActivityServiceError(
      401,
      "UNAUTHORIZED",
      "Sesi login Anda tidak ditemukan atau telah berakhir."
    )
  }

  if (code === "55P03" || lower.includes("lock timeout")) {
    return new ActivityServiceError(
      409,
      "LOCK_TIMEOUT",
      "Permintaan kegiatan sedang sibuk diproses secara bersamaan. Silakan coba beberapa saat lagi."
    )
  }

  if (code === "40001") {
    return new ActivityServiceError(
      409,
      "CONFLICT",
      "Data kegiatan baru saja diperbarui oleh pengguna lain. Silakan muat ulang."
    )
  }

  if (code === "42501" || lower.includes("forbidden")) {
    if (
      lower.includes("inactive or unlinked") ||
      lower.includes("is_activity_resident_eligible") ||
      lower.includes("not eligible")
    ) {
      return new ActivityServiceError(
        403,
        "INELIGIBLE_RESIDENT",
        "Hanya warga aktif pada rumah tangga aktif di RT ini yang dapat mendaftar kegiatan."
      )
    }

    if (
      lower.includes("pending deletion") ||
      lower.includes("retired") ||
      context?.operation === "attach_doc"
    ) {
      if (lower.includes("pending deletion") || lower.includes("retired")) {
        return new ActivityServiceError(
          410,
          "DOCUMENT_UNAVAILABLE",
          "Berkas dokumentasi sudah tidak tersedia atau sedang dalam antrean penghapusan."
        )
      }
    }

    return new ActivityServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin untuk mengakses atau mengubah data kegiatan ini."
    )
  }

  if (code === "P0002" || lower.includes("not found")) {
    if (lower.includes("storage path not referenced")) {
      return new ActivityServiceError(
        404,
        "DOCUMENT_UNAVAILABLE",
        "Berkas dokumentasi kegiatan tidak ditemukan atau sudah dilepas."
      )
    }
    if (lower.includes("participant")) {
      return new ActivityServiceError(
        404,
        "NOT_FOUND",
        "Data peserta kegiatan tidak ditemukan pada daftar aktif."
      )
    }
    if (lower.includes("registration not found")) {
      return new ActivityServiceError(
        404,
        "NOT_FOUND",
        "Anda belum terdaftar pada kegiatan ini."
      )
    }
    return new ActivityServiceError(
      404,
      "NOT_FOUND",
      "Kegiatan warga tidak ditemukan atau telah dihapus."
    )
  }

  if (code === "23505") {
    if (
      lower.includes("already registered") ||
      lower.includes("already enrolled") ||
      context?.operation === "register" ||
      context?.operation === "add_participant"
    ) {
      return new ActivityServiceError(
        409,
        "DUPLICATE_REGISTRATION",
        "Warga sudah terdaftar pada kegiatan ini dengan status tersebut."
      )
    }
    if (lower.includes("already attached")) {
      return new ActivityServiceError(
        409,
        "DUPLICATE_DOCUMENT",
        "Berkas dokumentasi tersebut sudah terlampir pada kegiatan."
      )
    }
    return new ActivityServiceError(
      409,
      "CONFLICT",
      "Data kegiatan bentrok dengan catatan yang sudah ada."
    )
  }

  if (code === "23503") {
    if (
      lower.includes("resident") ||
      context?.operation === "add_participant" ||
      context?.operation === "attendance"
    ) {
      return new ActivityServiceError(
        400,
        "INELIGIBLE_RESIDENT",
        "Warga tidak ditemukan, sudah tidak aktif, rumah tangga tidak aktif, atau berasal dari RT lain."
      )
    }
    if (lower.includes("storage") || context?.operation === "attach_doc") {
      return new ActivityServiceError(
        400,
        "DOCUMENT_UNAVAILABLE",
        "Berkas dokumentasi belum tersedia di penyimpanan privat."
      )
    }
    return new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      "Referensi data kegiatan tidak valid."
    )
  }

  if (code === "23514" || code === "22023") {
    if (
      lower.includes("capacity reached") ||
      lower.includes("cannot be lower than current registered count")
    ) {
      if (lower.includes("cannot be lower")) {
        return new ActivityServiceError(
          409,
          "CAPACITY_FULL",
          "Batas kuota peserta tidak boleh lebih kecil dari jumlah peserta aktif saat ini."
        )
      }
      return new ActivityServiceError(
        409,
        "CAPACITY_FULL",
        "Kuota peserta kegiatan sudah penuh."
      )
    }

    if (lower.includes("deadline has passed")) {
      return new ActivityServiceError(
        400,
        "DEADLINE_PASSED",
        "Batas waktu pendaftaran atau pelaksanaan kegiatan telah berakhir."
      )
    }

    if (lower.includes("self-registration is closed")) {
      return new ActivityServiceError(
        400,
        "REGISTRATION_CLOSED",
        "Pendaftaran mandiri sedang ditutup untuk kegiatan ini."
      )
    }

    if (lower.includes("documentation limit")) {
      return new ActivityServiceError(
        400,
        "DOCUMENT_LIMIT_REACHED",
        "Maksimal 20 berkas dokumentasi yang dapat dilampirkan per kegiatan."
      )
    }

    if (
      lower.includes("invalid activity transition") ||
      lower.includes("cannot update") ||
      lower.includes("cannot register") ||
      lower.includes("cannot cancel") ||
      lower.includes("cannot add participants") ||
      lower.includes("cannot remove participant") ||
      lower.includes("cannot record attendance") ||
      lower.includes("cannot attach docs") ||
      lower.includes("already marked absent") ||
      lower.includes("cannot be cancelled")
    ) {
      return new ActivityServiceError(
        400,
        "INVALID_STATE",
        "Status kegiatan atau pendaftaran saat ini tidak mengizinkan tindakan tersebut."
      )
    }

    if (lower.includes("end_at must be >= start_at")) {
      return new ActivityServiceError(
        400,
        "VALIDATION_ERROR",
        "Waktu selesai kegiatan harus sama dengan atau setelah waktu mulai."
      )
    }

    if (lower.includes("registration_deadline")) {
      return new ActivityServiceError(
        400,
        "VALIDATION_ERROR",
        "Batas waktu pendaftaran tidak boleh melewati waktu berakhirnya kegiatan."
      )
    }

    return new ActivityServiceError(
      400,
      "VALIDATION_ERROR",
      "Input data kegiatan tidak memenuhi ketentuan validasi."
    )
  }

  return new ActivityServiceError(
    500,
    "INTERNAL_ERROR",
    "Terjadi kesalahan saat memproses data kegiatan. Silakan coba lagi."
  )
}

