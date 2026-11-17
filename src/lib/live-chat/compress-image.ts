"use client"

import { CHAT_MAX_IMAGE_BYTES } from "@/lib/live-chat/schemas"

const ALLOWED_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])
const MAX_DIMENSION = 1600

export async function compressChatImage(file: File): Promise<File> {
  const mime = (file.type || "").toLowerCase()
  if (!ALLOWED_MIMES.has(mime)) {
    throw new Error("Format foto harus berupa JPEG, PNG, atau WebP.")
  }

  // Skip canvas re-encoding if already small (< 350 KB)
  if (file.size <= 350 * 1024) {
    return file
  }

  const bitmapUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("Gagal membaca file gambar."))
      el.src = bitmapUrl
    })

    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height, 1))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return file

    ctx.drawImage(img, 0, 0, width, height)

    const targetMime = mime === "image/webp" ? "image/webp" : "image/jpeg"
    const ext = targetMime === "image/webp" ? "webp" : "jpg"

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, targetMime, 0.82)
    )

    if (!blob || blob.size >= file.size) {
      if (file.size > CHAT_MAX_IMAGE_BYTES) {
        throw new Error("Ukuran foto melebihi batas maksimal 5 MB.")
      }
      return file
    }

    if (blob.size > CHAT_MAX_IMAGE_BYTES) {
      throw new Error("Ukuran foto setelah kompresi masih melebihi 5 MB.")
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "chat-photo"
    return new File([blob], `${baseName}.${ext}`, { type: targetMime })
  } finally {
    URL.revokeObjectURL(bitmapUrl)
  }
}

