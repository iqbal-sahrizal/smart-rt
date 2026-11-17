import {
  detectCommunityImageMimeFromBytes,
  type AllowedCommunityImageExt,
  type AllowedCommunityImageMime,
} from "@/lib/community-feed/storage"
import { CHAT_MAX_IMAGE_BYTES } from "@/lib/live-chat/schemas"

export const CHAT_MEDIA_BUCKET = "chat-media"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CHAT_MEDIA_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/

export interface ValidatedChatImageFile {
  buffer: Uint8Array
  mimeType: AllowedCommunityImageMime
  extension: AllowedCommunityImageExt
  size: number
}

export function isValidChatMediaPath(storagePath: string): boolean {
  return CHAT_MEDIA_PATH_RE.test(storagePath)
}

export function chatMediaPathBelongsToScope(
  storagePath: string,
  tenantId: string,
  roomId: string,
  memberId?: string
): boolean {
  if (!isValidChatMediaPath(storagePath)) return false
  const [pTenant, pRoom, pMember] = storagePath.split("/")
  if (pTenant !== tenantId.toLowerCase()) return false
  if (pRoom !== roomId.toLowerCase()) return false
  if (memberId && pMember !== memberId.toLowerCase()) return false
  return true
}

export function buildChatMediaPath(
  tenantId: string,
  roomId: string,
  memberId: string,
  extension: AllowedCommunityImageExt
): string {
  const t = tenantId.trim().toLowerCase()
  const r = roomId.trim().toLowerCase()
  const m = memberId.trim().toLowerCase()
  if (!UUID_RE.test(t) || !UUID_RE.test(r) || !UUID_RE.test(m)) {
    throw new Error("Invalid tenant, room, or member ID for chat media path")
  }
  return `${t}/${r}/${m}/${crypto.randomUUID().toLowerCase()}.${extension}`
}

export async function validateChatImageFile(
  fileEntry: FormDataEntryValue | File | null
): Promise<
  | { ok: true; file: ValidatedChatImageFile }
  | { ok: false; error: string }
> {
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, error: "Berkas foto wajib dipilih." }
  }

  if (fileEntry.size <= 0) {
    return { ok: false, error: "Berkas foto tidak boleh kosong." }
  }

  if (fileEntry.size > CHAT_MAX_IMAGE_BYTES) {
    return { ok: false, error: "Ukuran foto maksimal 5 MB." }
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
      error: "Format foto harus berupa JPEG, PNG, atau WebP.",
    }
  }

  const fullBuffer = new Uint8Array(await fileEntry.arrayBuffer())
  const detectedMime = detectCommunityImageMimeFromBytes(fullBuffer)

  if (!detectedMime) {
    return {
      ok: false,
      error: "Signature berkas tidak valid. Unggah foto JPEG, PNG, atau WebP asli.",
    }
  }

  const canonicalDeclared =
    normalizedMime === "image/jpg" ? "image/jpeg" : normalizedMime
  if (canonicalDeclared !== detectedMime) {
    return {
      ok: false,
      error: "Tipe berkas tidak sesuai dengan isi gambar.",
    }
  }

  const extMap: Record<AllowedCommunityImageMime, AllowedCommunityImageExt> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }

  return {
    ok: true,
    file: {
      buffer: fullBuffer,
      mimeType: detectedMime,
      extension: extMap[detectedMime],
      size: fullBuffer.byteLength,
    },
  }
}

