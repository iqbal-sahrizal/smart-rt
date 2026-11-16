import {
  ALLOWED_COMPLAINT_PHOTO_MIME_TYPES,
  COMPLAINT_PHOTO_BUCKET,
  MAX_COMPLAINT_PHOTO_BYTES,
} from "@/lib/complaints/constants"

export { COMPLAINT_PHOTO_BUCKET, MAX_COMPLAINT_PHOTO_BYTES }

export type AllowedComplaintPhotoMime =
  (typeof ALLOWED_COMPLAINT_PHOTO_MIME_TYPES)[number]

export type AllowedComplaintPhotoExt = "jpg" | "jpeg" | "png" | "webp"

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COMPLAINT_PHOTO_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/

const COMPLAINT_PHOTO_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i

export interface ValidatedComplaintPhoto {
  buffer: Uint8Array
  mimeType: AllowedComplaintPhotoMime
  extension: AllowedComplaintPhotoExt
  size: number
}

export function isValidComplaintPhotoPath(storagePath: string): boolean {
  return COMPLAINT_PHOTO_PATH_RE.test(storagePath)
}

export function complaintPhotoPathBelongsTo(
  storagePath: string,
  tenantId: string,
  complaintId: string
): boolean {
  if (!isValidComplaintPhotoPath(storagePath)) return false
  const [pathTenant, pathComplaint] = storagePath.split("/")
  return (
    pathTenant === tenantId.toLowerCase() &&
    pathComplaint === complaintId.toLowerCase()
  )
}

/**
 * Inspects file signature (magic bytes) independently from client-declared MIME.
 * Supports JPEG, PNG, and WebP (RIFF....WEBP).
 */
export function detectComplaintPhotoMimeFromBytes(
  bytes: Uint8Array
): AllowedComplaintPhotoMime | null {
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
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp"
  }

  return null
}

function normalizeFilenameExtension(filename: string): string {
  const idx = filename.lastIndexOf(".")
  if (idx === -1) return ""
  return filename.slice(idx + 1).trim().toLowerCase()
}

export async function validateComplaintPhotoFile(
  fileEntry: FormDataEntryValue | File | null
): Promise<
  | { ok: true; file: ValidatedComplaintPhoto }
  | { ok: false; error: string }
> {
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, error: "File foto pengaduan wajib diunggah." }
  }

  if (fileEntry.size <= 0) {
    return { ok: false, error: "File foto pengaduan tidak boleh kosong." }
  }

  if (fileEntry.size > MAX_COMPLAINT_PHOTO_BYTES) {
    return {
      ok: false,
      error: "Ukuran foto pengaduan maksimal 5 MiB.",
    }
  }

  const normalizedMime = (fileEntry.type ?? "").trim().toLowerCase()
  const isDeclaredAllowed =
    normalizedMime === "image/jpeg" ||
    normalizedMime === "image/jpg" ||
    normalizedMime === "image/png" ||
    normalizedMime === "image/webp"

  if (!isDeclaredAllowed) {
    return {
      ok: false,
      error: "Format foto pengaduan harus JPEG, PNG, atau WebP.",
    }
  }

  const arrayBuffer = await fileEntry.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const detectedMime = detectComplaintPhotoMimeFromBytes(bytes)

  if (!detectedMime) {
    return {
      ok: false,
      error:
        "Signature isi file tidak valid. Unggah gambar JPEG, PNG, atau WebP yang asli.",
    }
  }

  const canonicalDeclared =
    normalizedMime === "image/jpg" ? "image/jpeg" : normalizedMime
  if (canonicalDeclared !== detectedMime) {
    return {
      ok: false,
      error: "Tipe MIME foto tidak sesuai dengan isi berkas sebenarnya.",
    }
  }

  const rawExt = normalizeFilenameExtension(fileEntry.name ?? "")
  let extension: AllowedComplaintPhotoExt

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
    if (rawExt !== "webp") {
      return {
        ok: false,
        error: "Ekstensi berkas WebP harus .webp.",
      }
    }
    extension = "webp"
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

export function buildComplaintPhotoPath(
  tenantId: string,
  complaintId: string,
  extension: AllowedComplaintPhotoExt
): string {
  if (!UUID_SEGMENT_RE.test(tenantId) || !UUID_SEGMENT_RE.test(complaintId)) {
    throw new Error("Invalid tenantId or complaintId for complaint photo path")
  }
  const objectUuid = crypto.randomUUID().toLowerCase()
  const path = `${tenantId.toLowerCase()}/${complaintId.toLowerCase()}/${objectUuid}.${extension}`
  if (!COMPLAINT_PHOTO_PATH_RE.test(path)) {
    throw new Error("Generated invalid complaint photo storage path")
  }
  return path
}

export function inferComplaintPhotoContentType(storagePath: string): {
  contentType: AllowedComplaintPhotoMime
  extension: AllowedComplaintPhotoExt
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
 * Finds an already-uploaded but not-yet-attached photo under `<tenantId>/<complaintId>/`
 * so an interrupted upload can complete attachment via RPC without creating duplicates.
 */
export async function findUnattachedComplaintPhotoPath({
  supabase,
  tenantId,
  complaintId,
}: {
  supabase: StorageListClient
  tenantId: string
  complaintId: string
}): Promise<string | null> {
  if (!UUID_SEGMENT_RE.test(tenantId) || !UUID_SEGMENT_RE.test(complaintId)) {
    return null
  }
  const folder = `${tenantId.toLowerCase()}/${complaintId.toLowerCase()}`
  const { data, error } = await supabase.storage
    .from(COMPLAINT_PHOTO_BUCKET)
    .list(folder, {
      limit: 10,
      sortBy: { column: "created_at", order: "desc" },
    })

  if (error || !data || data.length === 0) {
    return null
  }

  for (const entry of data) {
    if (!COMPLAINT_PHOTO_FILENAME_RE.test(entry.name)) continue
    const candidate = `${folder}/${entry.name.toLowerCase()}`
    if (COMPLAINT_PHOTO_PATH_RE.test(candidate)) {
      return candidate
    }
  }

  return null
}

