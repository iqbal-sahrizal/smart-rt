import {
  ACTIVITY_DOCS_BUCKET,
  ALLOWED_ACTIVITY_DOC_MIME_TYPES,
  MAX_ACTIVITY_DOC_BYTES,
} from "@/lib/activities/constants"

export { ACTIVITY_DOCS_BUCKET, MAX_ACTIVITY_DOC_BYTES }

export type AllowedActivityDocMime =
  (typeof ALLOWED_ACTIVITY_DOC_MIME_TYPES)[number]

export type AllowedActivityDocExt = "jpg" | "jpeg" | "png" | "webp" | "pdf"

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ACTIVITY_DOC_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$/

export interface ValidatedActivityDocFile {
  buffer: Uint8Array
  mimeType: AllowedActivityDocMime
  extension: AllowedActivityDocExt
  size: number
}

export function isValidActivityDocPath(storagePath: string): boolean {
  return ACTIVITY_DOC_PATH_RE.test(storagePath)
}

export function activityDocPathBelongsTo(
  storagePath: string,
  tenantId: string,
  activityId: string
): boolean {
  if (!isValidActivityDocPath(storagePath)) return false
  const [pathTenant, pathActivity] = storagePath.split("/")
  return (
    pathTenant === tenantId.toLowerCase() &&
    pathActivity === activityId.toLowerCase()
  )
}

export function extractActivityDocFileId(storagePath: string): string | null {
  if (!isValidActivityDocPath(storagePath)) return null
  const filePart = storagePath.split("/")[2]
  if (!filePart) return null
  const dotIdx = filePart.lastIndexOf(".")
  if (dotIdx <= 0) return null
  return filePart.slice(0, dotIdx).toLowerCase()
}

/**
 * Inspects file header magic bytes independently of client-declared MIME type.
 * Supports JPEG, PNG, WebP (RIFF....WEBP), and PDF (%PDF-).
 */
export function detectActivityDocMimeFromBytes(
  bytes: Uint8Array
): AllowedActivityDocMime | null {
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

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
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

export async function validateActivityDocFile(
  fileEntry: FormDataEntryValue | File | null
): Promise<
  | { ok: true; file: ValidatedActivityDocFile }
  | { ok: false; error: string }
> {
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, error: "File dokumentasi kegiatan wajib diunggah." }
  }

  if (fileEntry.size <= 0) {
    return {
      ok: false,
      error: "File dokumentasi kegiatan tidak boleh kosong.",
    }
  }

  if (fileEntry.size > MAX_ACTIVITY_DOC_BYTES) {
    return {
      ok: false,
      error: "Ukuran berkas dokumentasi maksimal 10 MiB.",
    }
  }

  const normalizedMime = (fileEntry.type ?? "").trim().toLowerCase()
  const isDeclaredAllowed =
    normalizedMime === "image/jpeg" ||
    normalizedMime === "image/jpg" ||
    normalizedMime === "image/png" ||
    normalizedMime === "image/webp" ||
    normalizedMime === "application/pdf"

  if (!isDeclaredAllowed) {
    return {
      ok: false,
      error: "Format berkas dokumentasi harus JPEG, PNG, WebP, atau PDF.",
    }
  }

  const bytes = new Uint8Array(await fileEntry.arrayBuffer())
  const detectedMime = detectActivityDocMimeFromBytes(bytes)

  if (!detectedMime) {
    return {
      ok: false,
      error:
        "Signature isi file tidak valid. Unggah berkas JPEG, PNG, WebP, atau PDF yang asli.",
    }
  }

  const canonicalDeclared =
    normalizedMime === "image/jpg" ? "image/jpeg" : normalizedMime
  if (canonicalDeclared !== detectedMime) {
    return {
      ok: false,
      error: "Tipe file tidak sesuai dengan isi berkas yang diunggah.",
    }
  }

  const fileExt = normalizeFilenameExtension(fileEntry.name ?? "")
  const expectedExts: Record<
    AllowedActivityDocMime,
    readonly AllowedActivityDocExt[]
  > = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "application/pdf": ["pdf"],
  }
  const allowedExts = expectedExts[detectedMime]

  if (fileExt && !allowedExts.includes(fileExt as AllowedActivityDocExt)) {
    return {
      ok: false,
      error: "Ekstensi nama file tidak cocok dengan tipe berkas.",
    }
  }

  const extension: AllowedActivityDocExt =
    fileExt && allowedExts.includes(fileExt as AllowedActivityDocExt)
      ? (fileExt as AllowedActivityDocExt)
      : allowedExts[0]

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

export function buildActivityDocPath(
  tenantId: string,
  activityId: string,
  extension: AllowedActivityDocExt
): string {
  const safeTenant = tenantId.trim().toLowerCase()
  const safeActivity = activityId.trim().toLowerCase()

  if (!UUID_SEGMENT_RE.test(safeTenant) || !UUID_SEGMENT_RE.test(safeActivity)) {
    throw new Error("Invalid tenantId or activityId for activity-docs path")
  }

  const fileId = crypto.randomUUID().toLowerCase()
  return `${safeTenant}/${safeActivity}/${fileId}.${extension}`
}

export function inferActivityDocContentType(storagePath: string): {
  contentType: AllowedActivityDocMime
  extension: AllowedActivityDocExt
} {
  const lower = storagePath.toLowerCase()
  if (lower.endsWith(".png")) {
    return { contentType: "image/png", extension: "png" }
  }
  if (lower.endsWith(".webp")) {
    return { contentType: "image/webp", extension: "webp" }
  }
  if (lower.endsWith(".pdf")) {
    return { contentType: "application/pdf", extension: "pdf" }
  }
  if (lower.endsWith(".jpeg")) {
    return { contentType: "image/jpeg", extension: "jpeg" }
  }
  return { contentType: "image/jpeg", extension: "jpg" }
}

export function buildActivityDocApiUrl(
  activityId: string,
  fileId: string,
  download = false
): string {
  const safeId = encodeURIComponent(activityId)
  const safeFileId = encodeURIComponent(fileId)
  return `/api/activities/${safeId}/documents/${safeFileId}${download ? "?download=1" : ""}`
}

