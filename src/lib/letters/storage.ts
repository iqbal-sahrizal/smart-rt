import {
  ALLOWED_ISSUED_LETTER_MIME_TYPES,
  ALLOWED_LETTER_ATTACHMENT_MIME_TYPES,
  ISSUED_LETTERS_BUCKET,
  LETTER_REQUEST_DOCS_BUCKET,
  MAX_ISSUED_LETTER_PDF_BYTES,
  MAX_LETTER_ATTACHMENT_BYTES,
} from "@/lib/letters/constants"

export {
  ISSUED_LETTERS_BUCKET,
  LETTER_REQUEST_DOCS_BUCKET,
  MAX_ISSUED_LETTER_PDF_BYTES,
  MAX_LETTER_ATTACHMENT_BYTES,
}

export type AllowedLetterAttachmentMime =
  (typeof ALLOWED_LETTER_ATTACHMENT_MIME_TYPES)[number]

export type AllowedIssuedLetterMime =
  (typeof ALLOWED_ISSUED_LETTER_MIME_TYPES)[number]

export type AllowedLetterAttachmentExt = "jpg" | "jpeg" | "png" | "pdf"

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LETTER_ATTACHMENT_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf)$/

const ISSUED_LETTER_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/

export interface ValidatedLetterAttachmentFile {
  buffer: Uint8Array
  mimeType: AllowedLetterAttachmentMime
  extension: AllowedLetterAttachmentExt
  size: number
}

export interface ValidatedIssuedLetterPdfFile {
  buffer: Uint8Array
  mimeType: AllowedIssuedLetterMime
  extension: "pdf"
  size: number
}

export function isValidLetterAttachmentPath(storagePath: string): boolean {
  return LETTER_ATTACHMENT_PATH_RE.test(storagePath)
}

export function letterAttachmentPathBelongsTo(
  storagePath: string,
  tenantId: string,
  requestId: string
): boolean {
  if (!isValidLetterAttachmentPath(storagePath)) return false
  const [pathTenant, pathRequest] = storagePath.split("/")
  return (
    pathTenant === tenantId.toLowerCase() &&
    pathRequest === requestId.toLowerCase()
  )
}

export function extractLetterAttachmentFileId(
  storagePath: string
): string | null {
  if (!isValidLetterAttachmentPath(storagePath)) return null
  const filePart = storagePath.split("/")[2]
  if (!filePart) return null
  const dotIdx = filePart.lastIndexOf(".")
  if (dotIdx <= 0) return null
  return filePart.slice(0, dotIdx).toLowerCase()
}

export function isValidIssuedLetterPdfPath(storagePath: string): boolean {
  return ISSUED_LETTER_PATH_RE.test(storagePath)
}

export function issuedLetterPdfPathBelongsTo(
  storagePath: string,
  tenantId: string,
  requestId: string
): boolean {
  if (!isValidIssuedLetterPdfPath(storagePath)) return false
  const [pathTenant, pathRequest] = storagePath.split("/")
  return (
    pathTenant === tenantId.toLowerCase() &&
    pathRequest === requestId.toLowerCase()
  )
}

/**
 * Inspects file signature (magic bytes) independently from client-declared MIME.
 * Supports JPEG, PNG, and PDF (%PDF-).
 */
export function detectLetterMimeFromBytes(
  bytes: Uint8Array
): AllowedLetterAttachmentMime | null {
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
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
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

export async function validateLetterAttachmentFile(
  fileEntry: FormDataEntryValue | File | null
): Promise<
  | { ok: true; file: ValidatedLetterAttachmentFile }
  | { ok: false; error: string }
> {
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, error: "File dokumen pendukung wajib diunggah." }
  }

  if (fileEntry.size <= 0) {
    return { ok: false, error: "File dokumen pendukung tidak boleh kosong." }
  }

  if (fileEntry.size > MAX_LETTER_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: "Ukuran dokumen pendukung maksimal 5 MiB.",
    }
  }

  const normalizedMime = (fileEntry.type ?? "").trim().toLowerCase()
  const isDeclaredAllowed =
    normalizedMime === "image/jpeg" ||
    normalizedMime === "image/jpg" ||
    normalizedMime === "image/png" ||
    normalizedMime === "application/pdf"

  if (!isDeclaredAllowed) {
    return {
      ok: false,
      error: "Format dokumen pendukung harus JPEG, PNG, atau PDF.",
    }
  }

  const arrayBuffer = await fileEntry.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const detectedMime = detectLetterMimeFromBytes(bytes)

  if (!detectedMime) {
    return {
      ok: false,
      error:
        "Signature isi berkas tidak valid. Unggah JPEG, PNG, atau PDF yang asli.",
    }
  }

  const canonicalDeclared =
    normalizedMime === "image/jpg" ? "image/jpeg" : normalizedMime
  if (canonicalDeclared !== detectedMime) {
    return {
      ok: false,
      error: "Tipe MIME berkas tidak sesuai dengan isi berkas sebenarnya.",
    }
  }

  const rawExt = normalizeFilenameExtension(fileEntry.name ?? "")
  let extension: AllowedLetterAttachmentExt

  if (detectedMime === "image/jpeg") {
    if (rawExt !== "jpg" && rawExt !== "jpeg") {
      return {
        ok: false,
        error: "Ekstensi berkas JPEG harus .jpg atau .jpeg.",
      }
    }
    extension = rawExt
  } else if (detectedMime === "image/png") {
    if (rawExt !== "png") {
      return {
        ok: false,
        error: "Ekstensi berkas PNG harus .png.",
      }
    }
    extension = "png"
  } else {
    if (rawExt !== "pdf") {
      return {
        ok: false,
        error: "Ekstensi berkas PDF harus .pdf.",
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

export async function validateIssuedLetterPdfFile(
  fileEntry: FormDataEntryValue | File | null
): Promise<
  | { ok: true; file: ValidatedIssuedLetterPdfFile }
  | { ok: false; error: string }
> {
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, error: "File PDF surat terbit wajib diunggah." }
  }

  if (fileEntry.size <= 0) {
    return { ok: false, error: "File PDF surat terbit tidak boleh kosong." }
  }

  if (fileEntry.size > MAX_ISSUED_LETTER_PDF_BYTES) {
    return {
      ok: false,
      error: "Ukuran file PDF surat terbit maksimal 10 MiB.",
    }
  }

  const normalizedMime = (fileEntry.type ?? "").trim().toLowerCase()
  if (normalizedMime !== "application/pdf") {
    return {
      ok: false,
      error: "Format surat terbit harus berupa PDF (application/pdf).",
    }
  }

  const rawExt = normalizeFilenameExtension(fileEntry.name ?? "")
  if (rawExt !== "pdf") {
    return {
      ok: false,
      error: "Ekstensi berkas surat terbit harus .pdf.",
    }
  }

  const arrayBuffer = await fileEntry.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const detectedMime = detectLetterMimeFromBytes(bytes)

  if (detectedMime !== "application/pdf") {
    return {
      ok: false,
      error:
        "Signature isi berkas tidak valid. Unggah dokumen PDF (%PDF-) yang asli.",
    }
  }

  return {
    ok: true,
    file: {
      buffer: bytes,
      mimeType: "application/pdf",
      extension: "pdf",
      size: bytes.byteLength,
    },
  }
}

export function buildLetterAttachmentPath(
  tenantId: string,
  requestId: string,
  extension: AllowedLetterAttachmentExt
): string {
  if (!UUID_SEGMENT_RE.test(tenantId) || !UUID_SEGMENT_RE.test(requestId)) {
    throw new Error("Invalid tenantId or requestId for letter attachment path")
  }
  const objectUuid = crypto.randomUUID().toLowerCase()
  const path = `${tenantId.toLowerCase()}/${requestId.toLowerCase()}/${objectUuid}.${extension}`
  if (!LETTER_ATTACHMENT_PATH_RE.test(path)) {
    throw new Error("Generated invalid letter attachment storage path")
  }
  return path
}

export function buildIssuedLetterPdfPath(
  tenantId: string,
  requestId: string
): string {
  if (!UUID_SEGMENT_RE.test(tenantId) || !UUID_SEGMENT_RE.test(requestId)) {
    throw new Error("Invalid tenantId or requestId for issued letter PDF path")
  }
  const objectUuid = crypto.randomUUID().toLowerCase()
  const path = `${tenantId.toLowerCase()}/${requestId.toLowerCase()}/${objectUuid}.pdf`
  if (!ISSUED_LETTER_PATH_RE.test(path)) {
    throw new Error("Generated invalid issued letter PDF storage path")
  }
  return path
}

export function inferLetterAttachmentContentType(storagePath: string): {
  contentType: AllowedLetterAttachmentMime
  extension: AllowedLetterAttachmentExt
} {
  const lower = storagePath.toLowerCase()
  if (lower.endsWith(".pdf")) {
    return { contentType: "application/pdf", extension: "pdf" }
  }
  if (lower.endsWith(".png")) {
    return { contentType: "image/png", extension: "png" }
  }
  if (lower.endsWith(".jpeg")) {
    return { contentType: "image/jpeg", extension: "jpeg" }
  }
  return { contentType: "image/jpeg", extension: "jpg" }
}

export function buildLetterAttachmentApiUrl(
  requestId: string,
  fileId: string
): string {
  return `/api/letters/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(fileId)}`
}

export function buildIssuedLetterApiUrl(
  requestId: string,
  download = false
): string {
  const base = `/api/letters/${encodeURIComponent(requestId)}/issued`
  return download ? `${base}?download=1` : base
}

