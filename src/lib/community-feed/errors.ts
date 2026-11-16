import type { CommunityActionErrorCode } from "@/lib/community-feed/types"

export class CommunityFeedServiceError extends Error {
  readonly status: number
  readonly code: CommunityActionErrorCode

  constructor(
    status: number,
    code: CommunityActionErrorCode,
    message: string
  ) {
    super(message)
    this.name = "CommunityFeedServiceError"
    this.status = status
    this.code = code
  }
}

export function mapCommunityFeedDbError(error: {
  code?: string | null
  message?: string | null
}): CommunityFeedServiceError {
  const code = error.code ?? ""
  const lower = (error.message ?? "").toLowerCase()

  if (code === "28000" || lower.includes("unauthenticated")) {
    return new CommunityFeedServiceError(
      401,
      "UNAUTHORIZED",
      "Sesi login tidak ditemukan atau telah berakhir."
    )
  }

  if (code === "42501" || lower.includes("forbidden")) {
    return new CommunityFeedServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin untuk mengakses atau mengubah konten ini."
    )
  }

  if (code === "P0002" || lower.includes("not found")) {
    return new CommunityFeedServiceError(
      404,
      "NOT_FOUND",
      "Postingan, komentar, atau laporan tidak ditemukan atau sudah tidak tersedia."
    )
  }

  if (code === "23505") {
    if (lower.includes("report")) {
      return new CommunityFeedServiceError(
        409,
        "CONFLICT",
        "Anda sudah melaporkan konten ini sebelumnya dan laporan masih menunggu peninjauan."
      )
    }
    return new CommunityFeedServiceError(
      409,
      "CONFLICT",
      "Tindakan ini bentrok dengan data yang sudah tercatat."
    )
  }

  if (code === "23503") {
    if (lower.includes("storage")) {
      return new CommunityFeedServiceError(
        400,
        "MEDIA_ERROR",
        "Berkas foto yang diunggah tidak ditemukan di penyimpanan privat."
      )
    }
    return new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "Referensi data tidak valid atau berasal dari tenant berbeda."
    )
  }

  if (code === "22023" || code === "23514") {
    if (lower.includes("own content")) {
      return new CommunityFeedServiceError(
        400,
        "VALIDATION_ERROR",
        "Anda tidak dapat melaporkan konten milik Anda sendiri."
      )
    }
    if (lower.includes("maximum 4 media")) {
      return new CommunityFeedServiceError(
        400,
        "VALIDATION_ERROR",
        "Maksimal 4 foto per postingan."
      )
    }
    if (lower.includes("cannot be empty") || lower.includes("must contain")) {
      return new CommunityFeedServiceError(
        400,
        "VALIDATION_ERROR",
        "Postingan tidak boleh kosong tanpa keterangan dan foto."
      )
    }
    if (lower.includes("reason is required")) {
      return new CommunityFeedServiceError(
        400,
        "VALIDATION_ERROR",
        "Alasan moderasi wajib diisi minimal 3 karakter."
      )
    }
    return new CommunityFeedServiceError(
      400,
      "VALIDATION_ERROR",
      "Data yang dikirim tidak memenuhi ketentuan validasi."
    )
  }

  if (code === "40001" || code === "55P03") {
    return new CommunityFeedServiceError(
      409,
      "CONFLICT",
      "Konten sedang diproses bersamaan oleh permintaan lain. Silakan coba lagi."
    )
  }

  return new CommunityFeedServiceError(
    500,
    "INTERNAL_ERROR",
    "Terjadi kesalahan saat memproses feed komunitas. Silakan coba lagi."
  )
}

