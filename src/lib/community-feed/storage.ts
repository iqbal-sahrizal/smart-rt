import {
  ALLOWED_COMMUNITY_IMAGE_MIME_TYPES,
  COMMUNITY_MEDIA_BUCKET,
  MAX_COMMUNITY_IMAGE_BYTES,
} from "@/lib/community-feed/constants"

export { COMMUNITY_MEDIA_BUCKET, MAX_COMMUNITY_IMAGE_BYTES }

export type AllowedCommunityImageMime =
  (typeof ALLOWED_COMMUNITY_IMAGE_MIME_TYPES)[number]

export type AllowedCommunityImageExt = "jpg" | "jpeg" | "png" | "webp"

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COMMUNITY_MEDIA_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/

export interface ValidatedCommunityImageFile {
  buffer: Uint8Array
  mimeType: AllowedCommunityImageMime
  extension: AllowedCommunityImageExt
  size: number
}

export function isValidCommunityMediaPath(storagePath: string): boolean {
  return COMMUNITY_MEDIA_PATH_RE.test(storagePath)
}

export function communityMediaPathBelongsToTenant(
  storagePath: string,
  tenantId: string
): boolean {
  if (!isValidCommunityMediaPath(storagePath)) return false
  const [pathTenant] = storagePath.split("/")
  return pathTenant === tenantId.toLowerCase()
}

export function communityMediaPathBelongsToMember(
  storagePath: string,
  tenantId: string,
  memberId: string
): boolean {
  if (!isValidCommunityMediaPath(storagePath)) return false
  const [pathTenant, pathMember] = storagePath.split("/")
  return (
    pathTenant === tenantId.toLowerCase() &&
    pathMember === memberId.toLowerCase()
  )
}

/**
 * Inspects binary file header magic bytes independently of browser-declared MIME.
 * Supports JPEG, PNG, and WebP (RIFF....WEBP).
 */
export function detectCommunityImageMimeFromBytes(
  bytes: Uint8Array
): AllowedCommunityImageMime | null {
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

  return null
}

function normalizeExtension(filename: string): string {
  const idx = filename.lastIndexOf(".")
  if (idx === -1) return ""
  return filename.slice(idx + 1).trim().toLowerCase()
}

export async function validateCommunityImageFile(
  fileEntry: FormDataEntryValue | File | null
): Promise<
  | { ok: true; file: ValidatedCommunityImageFile }
  | { ok: false; error: string }
> {
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, error: "Berkas gambar wajib dipilih." }
  }

  if (fileEntry.size <= 0) {
    return { ok: false, error: "Berkas gambar tidak boleh kosong." }
  }

  if (fileEntry.size > MAX_COMMUNITY_IMAGE_BYTES) {
    return { ok: false, error: "Ukuran setiap gambar maksimal 5 MiB." }
  }

  const normalizedMime = (fileEntry.type ?? "").trim().toLowerCase()
  const declaredOk =
    normalizedMime === "image/jpeg" ||
    normalizedMime === "image/jpg" ||
    normalizedMime === "image/png" ||
    normalizedMime === "image/webp"

  if (!declaredOk) {
    return {
      ok: false,
      error: "Format gambar harus berupa JPEG, PNG, atau WebP.",
    }
  }

  const headerSlice =
    fileEntry.size > 4096 && typeof fileEntry.slice === "function"
      ? await fileEntry.slice(0, 64).arrayBuffer()
      : null

  const fullBuffer = new Uint8Array(await fileEntry.arrayBuffer())
  const inspectBytes = headerSlice ? new Uint8Array(headerSlice) : fullBuffer
  const detectedMime = detectCommunityImageMimeFromBytes(inspectBytes)

  if (!detectedMime) {
    return {
      ok: false,
      error:
        "Signature berkas tidak valid. Unggah gambar JPEG, PNG, atau WebP asli.",
    }
  }

  const canonicalDeclared =
    normalizedMime === "image/jpg" ? "image/jpeg" : normalizedMime
  if (canonicalDeclared !== detectedMime) {
    return {
      ok: false,
      error: "Tipe berkas tidak sesuai dengan isi gambar yang diunggah.",
    }
  }

  const ext = normalizeExtension(fileEntry.name ?? "")
  const expectedExts: Record<
    AllowedCommunityImageMime,
    readonly AllowedCommunityImageExt[]
  > = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
  }
  const allowedExts = expectedExts[detectedMime]

  if (ext && !allowedExts.includes(ext as AllowedCommunityImageExt)) {
    return {
      ok: false,
      error: "Ekstensi berkas tidak cocok dengan tipe gambar.",
    }
  }

  const extension: AllowedCommunityImageExt =
    ext && allowedExts.includes(ext as AllowedCommunityImageExt)
      ? (ext as AllowedCommunityImageExt)
      : allowedExts[0]

  return {
    ok: true,
    file: {
      buffer: fullBuffer,
      mimeType: detectedMime,
      extension,
      size: fullBuffer.byteLength,
    },
  }
}

export function buildCommunityMediaPath(
  tenantId: string,
  memberId: string,
  extension: AllowedCommunityImageExt
): string {
  const safeTenant = tenantId.trim().toLowerCase()
  const safeMember = memberId.trim().toLowerCase()

  if (!UUID_SEGMENT_RE.test(safeTenant) || !UUID_SEGMENT_RE.test(safeMember)) {
    throw new Error("Invalid tenantId or memberId for community media path")
  }

  const fileId = crypto.randomUUID().toLowerCase()
  return `${safeTenant}/${safeMember}/${fileId}.${extension}`
}

export function inferCommunityMediaContentType(storagePath: string): {
  contentType: AllowedCommunityImageMime
  extension: AllowedCommunityImageExt
} {
  const lower = storagePath.toLowerCase()
  if (lower.endsWith(".png")) {
    return { contentType: "image/png", extension: "png" }
  }
  if (lower.endsWith(".webp")) {
    return { contentType: "image/webp", extension: "webp" }
  }
  if (lower.endsWith(".jpeg")) {
    return { contentType: "image/jpeg", extension: "jpeg" }
  }
  return { contentType: "image/jpeg", extension: "jpg" }
}

export function buildCommunityMediaApiUrl(mediaId: string): string {
  return `/api/community-feed/media/${encodeURIComponent(mediaId)}`
}

