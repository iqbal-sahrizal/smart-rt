export const PAYMENT_PROOFS_BUCKET = "payment-proofs"
export const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024 // 5 MiB

export const ALLOWED_PAYMENT_PROOF_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const

export type AllowedPaymentProofMime =
  (typeof ALLOWED_PAYMENT_PROOF_MIME_TYPES)[number]

export type AllowedPaymentProofExt = "jpg" | "jpeg" | "png" | "pdf"

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PAYMENT_PROOF_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$/

const PAYMENT_PROOF_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$/i

export function isValidPaymentProofPath(storagePath: string): boolean {
  return PAYMENT_PROOF_PATH_RE.test(storagePath)
}

export function paymentProofPathBelongsTo(
  storagePath: string,
  tenantId: string,
  paymentId: string
): boolean {
  if (!isValidPaymentProofPath(storagePath)) return false
  const parts = storagePath.split("/")
  return (
    parts[0] === tenantId.toLowerCase() &&
    parts[1] === paymentId.toLowerCase()
  )
}

export interface ValidatedPaymentProof {
  buffer: Uint8Array
  mimeType: AllowedPaymentProofMime
  extension: AllowedPaymentProofExt
  size: number
}

function detectMimeFromMagicBytes(
  bytes: Uint8Array
): AllowedPaymentProofMime | null {
  if (bytes.length < 4) return null

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }

  // PDF: %PDF-
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf"
  }

  return null
}

function normalizeFilenameExtension(filename: string): string {
  const idx = filename.lastIndexOf(".")
  if (idx === -1) return ""
  return filename.slice(idx + 1).trim().toLowerCase()
}

export async function validatePaymentProofFile(
  fileEntry: FormDataEntryValue | null
): Promise<
  | { ok: true; file: ValidatedPaymentProof }
  | { ok: false; error: string }
> {
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, error: "Bukti pembayaran wajib diunggah." }
  }

  if (fileEntry.size <= 0) {
    return { ok: false, error: "File bukti pembayaran tidak boleh kosong." }
  }

  if (fileEntry.size > MAX_PAYMENT_PROOF_BYTES) {
    return {
      ok: false,
      error: "Ukuran bukti pembayaran maksimal 5 MB.",
    }
  }

  const normalizedMime = fileEntry.type.trim().toLowerCase()
  const isDeclaredAllowed =
    normalizedMime === "image/jpeg" ||
    normalizedMime === "image/jpg" ||
    normalizedMime === "image/png" ||
    normalizedMime === "application/pdf" ||
    normalizedMime === ""

  if (!isDeclaredAllowed) {
    return {
      ok: false,
      error: "Format bukti pembayaran harus JPG, PNG, atau PDF.",
    }
  }

  const arrayBuffer = await fileEntry.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const detectedMime = detectMimeFromMagicBytes(bytes)

  if (!detectedMime) {
    return {
      ok: false,
      error:
        "Isi file tidak valid. Unggah gambar JPG/PNG atau dokumen PDF yang valid.",
    }
  }

  if (normalizedMime !== "") {
    const canonicalDeclared =
      normalizedMime === "image/jpg" ? "image/jpeg" : normalizedMime
    if (canonicalDeclared !== detectedMime) {
      return {
        ok: false,
        error:
          "Jenis file bukti pembayaran tidak sesuai dengan format isinya.",
      }
    }
  }

  const rawExt = normalizeFilenameExtension(fileEntry.name)
  let extension: AllowedPaymentProofExt
  if (detectedMime === "image/jpeg") {
    if (rawExt && rawExt !== "jpg" && rawExt !== "jpeg") {
      return {
        ok: false,
        error: "Ekstensi file harus .jpg atau .jpeg untuk gambar JPEG.",
      }
    }
    extension = rawExt === "jpeg" ? "jpeg" : "jpg"
  } else if (detectedMime === "image/png") {
    if (rawExt && rawExt !== "png") {
      return {
        ok: false,
        error: "Ekstensi file harus .png untuk gambar PNG.",
      }
    }
    extension = "png"
  } else {
    if (rawExt && rawExt !== "pdf") {
      return {
        ok: false,
        error: "Ekstensi file harus .pdf untuk dokumen PDF.",
      }
    }
    extension = "pdf"
  }

  return {
    ok: true,
    file: {
      buffer: bytes,
      mimeType: detectedMime,
      extension,
      size: bytes.byteLength,
    },
  }
}

export function buildPaymentProofPath(
  tenantId: string,
  paymentId: string,
  extension: AllowedPaymentProofExt
): string {
  if (!UUID_SEGMENT_RE.test(tenantId) || !UUID_SEGMENT_RE.test(paymentId)) {
    throw new Error("Invalid tenantId or paymentId for storage path")
  }
  const objectUuid = crypto.randomUUID().toLowerCase()
  const path = `${tenantId.toLowerCase()}/${paymentId.toLowerCase()}/${objectUuid}.${extension}`
  if (!PAYMENT_PROOF_PATH_RE.test(path)) {
    throw new Error("Generated invalid payment proof storage path")
  }
  return path
}

export function inferContentTypeFromStoragePath(storagePath: string): {
  contentType: AllowedPaymentProofMime
  extension: AllowedPaymentProofExt
} {
  const lower = storagePath.toLowerCase()
  if (lower.endsWith(".png")) {
    return { contentType: "image/png", extension: "png" }
  }
  if (lower.endsWith(".pdf")) {
    return { contentType: "application/pdf", extension: "pdf" }
  }
  if (lower.endsWith(".jpeg")) {
    return { contentType: "image/jpeg", extension: "jpeg" }
  }
  return { contentType: "image/jpeg", extension: "jpg" }
}

interface StorageListClient {
  storage: {
    from: (bucket: string) => {
      list: (
        path?: string,
        options?: {
          limit?: number
          sortBy?: { column?: string; order?: string }
        }
      ) => Promise<{
        data: Array<{ name: string }> | null
        error: { message: string } | null
      }>
    }
  }
}

/**
 * Inspects the private storage folder for an incomplete payment row so an
 * interrupted submission whose file upload succeeded can attach the existing
 * object without creating duplicate files or duplicate payment records.
 */
export async function findUploadedPaymentProofPath({
  supabase,
  tenantId,
  paymentId,
}: {
  supabase: StorageListClient
  tenantId: string
  paymentId: string
}): Promise<string | null> {
  if (!UUID_SEGMENT_RE.test(tenantId) || !UUID_SEGMENT_RE.test(paymentId)) {
    return null
  }
  const folder = `${tenantId.toLowerCase()}/${paymentId.toLowerCase()}`
  const { data, error } = await supabase.storage
    .from(PAYMENT_PROOFS_BUCKET)
    .list(folder, {
      limit: 10,
      sortBy: { column: "created_at", order: "desc" },
    })

  if (error || !data || data.length === 0) {
    return null
  }

  for (const entry of data) {
    if (!PAYMENT_PROOF_FILENAME_RE.test(entry.name)) continue
    const candidate = `${folder}/${entry.name.toLowerCase()}`
    if (PAYMENT_PROOF_PATH_RE.test(candidate)) {
      return candidate
    }
  }

  return null
}

