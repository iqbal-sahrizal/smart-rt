import type { LetterActionErrorCode } from "@/lib/letters/types"

export class LetterServiceError extends Error {
  readonly status: number
  readonly code: LetterActionErrorCode

  constructor(status: number, code: LetterActionErrorCode, message: string) {
    super(message)
    this.name = "LetterServiceError"
    this.status = status
    this.code = code
  }
}

export interface DbErrorLike {
  code?: string | null
  message?: string | null
}

export function mapLetterDbError(
  error: DbErrorLike,
  context?: { operation?: "create_request" | "letter_type" | "attachment" | "issue" | "review" | "cancel" }
): LetterServiceError {
  const code = error.code ?? ""
  const lower = (error.message ?? "").toLowerCase()

  if (lower.includes("unauthenticated")) {
    return new LetterServiceError(
      401,
      "UNAUTHORIZED",
      "Sesi login tidak ditemukan atau telah berakhir."
    )
  }

  if (code === "42501" || lower.includes("forbidden")) {
    if (
      context?.operation === "create_request" ||
      lower.includes("is_letter_resident_eligible") ||
      lower.includes("letter_requests_insert")
    ) {
      return new LetterServiceError(
        403,
        "INELIGIBLE_RESIDENT",
        "Pengajuan surat tidak dapat diproses. Pastikan status warga, rumah tangga, dan jenis surat aktif pada RT ini."
      )
    }
    return new LetterServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin untuk mengakses atau mengubah data surat ini."
    )
  }

  if (code === "P0002" || lower.includes("not found")) {
    return new LetterServiceError(
      404,
      "NOT_FOUND",
      context?.operation === "letter_type"
        ? "Jenis surat tidak ditemukan."
        : "Permohonan atau dokumen surat tidak ditemukan."
    )
  }

  if (code === "23505") {
    if (
      lower.includes("uq_letter_types_tenant_normalized_code") ||
      lower.includes("uq_letter_types_tenant_code") ||
      context?.operation === "letter_type"
    ) {
      return new LetterServiceError(
        409,
        "CONFLICT",
        "Kode jenis surat bentrok dengan kode jenis surat lain yang sudah ada pada RT ini."
      )
    }
    if (lower.includes("already attached")) {
      return new LetterServiceError(
        409,
        "DUPLICATE_ATTACHMENT",
        "Dokumen pendukung tersebut sudah terlampir pada permohonan surat."
      )
    }
    return new LetterServiceError(
      409,
      "CONFLICT",
      "Data surat bentrok dengan data yang sudah tercatat."
    )
  }

  if (code === "22023" || code === "23514") {
    if (
      lower.includes("maximum 5 supporting documents") ||
      lower.includes("5 supporting")
    ) {
      return new LetterServiceError(
        400,
        "ATTACHMENT_LIMIT_REACHED",
        "Maksimal 5 dokumen pendukung yang dapat dilampirkan per permohonan surat."
      )
    }
    if (
      lower.includes("invalid letter review transition") ||
      lower.includes("only submitted") ||
      lower.includes("only approved") ||
      lower.includes("only be attached while submitted")
    ) {
      return new LetterServiceError(
        400,
        "INVALID_STATE",
        "Status permohonan surat tidak sesuai untuk tindakan ini."
      )
    }
    if (lower.includes("admin notes are required")) {
      return new LetterServiceError(
        400,
        "VALIDATION_ERROR",
        "Catatan alasan penolakan wajib diisi saat menolak permohonan surat."
      )
    }
    return new LetterServiceError(
      400,
      "VALIDATION_ERROR",
      "Data surat tidak memenuhi ketentuan validasi."
    )
  }

  if (code === "23503") {
    if (context?.operation === "letter_type") {
      return new LetterServiceError(
        409,
        "CONFLICT",
        "Jenis surat tidak dapat dihapus karena masih digunakan oleh permohonan surat."
      )
    }
    return new LetterServiceError(
      400,
      "STORAGE_ERROR",
      "Berkas dokumen tidak ditemukan di penyimpanan privat."
    )
  }

  if (code === "40001") {
    return new LetterServiceError(
      409,
      "CONFLICT",
      "Permohonan surat sedang diproses oleh permintaan lain. Silakan muat ulang."
    )
  }

  return new LetterServiceError(
    500,
    "INTERNAL_ERROR",
    "Gagal memproses permintaan surat. Silakan coba lagi."
  )
}

