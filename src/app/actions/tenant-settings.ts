"use server"

import { revalidatePath } from "next/cache"

import { requireAdminContext } from "@/lib/auth/guards"
import { createClient } from "@/lib/supabase/server"
import { tenantIdentitySchema } from "@/lib/tenants/schemas"
import { getTenantIdentity } from "@/lib/tenants/queries"
import { detectComplaintPhotoMimeFromBytes } from "@/lib/complaints/storage"

export interface TenantActionState {
  ok: boolean
  message?: string
  error?: string | null
  fieldErrors?: Record<string, string[]>
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MiB

export async function updateTenantIdentityAction(
  prevState: TenantActionState,
  formData: FormData
): Promise<TenantActionState> {
  const { tenant } = await requireAdminContext()

  if (!tenant.roles.includes("ketua_rt") && !tenant.roles.includes("sekretaris")) {
    return {
      ok: false,
      error: "Hanya Ketua RT atau Sekretaris yang memiliki izin mengubah identitas RT.",
    }
  }

  const raw = {
    name: formData.get("name")?.toString() ?? "",
    rtNumber: formData.get("rtNumber")?.toString() ?? "",
    rwNumber: formData.get("rwNumber")?.toString() ?? "",
    kelurahan: formData.get("kelurahan")?.toString() ?? "",
    kecamatan: formData.get("kecamatan")?.toString() ?? "",
    city: formData.get("city")?.toString() ?? "",
    province: formData.get("province")?.toString() ?? "",
    postalCode: formData.get("postalCode")?.toString() ?? "",
    logoUrl: formData.get("logoUrl")?.toString() ?? "",
  }

  const parsed = tenantIdentitySchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: "Terdapat data yang tidak valid. Periksa kembali formulir.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { data } = parsed
  const supabase = await createClient()

  const { error: rpcErr } = await supabase.rpc("update_tenant_identity", {
    p_tenant_id: tenant.tenantId,
    p_name: data.name,
    p_rt_number: data.rtNumber,
    p_rw_number: data.rwNumber,
    p_kelurahan: data.kelurahan,
    p_kecamatan: data.kecamatan,
    p_city: data.city,
    p_province: data.province,
    p_postal_code: data.postalCode || null,
    p_logo_url: data.logoUrl || null,
  })

  if (rpcErr) {
    return {
      ok: false,
      error: rpcErr.message || "Gagal memperbarui identitas RT.",
    }
  }

  revalidatePath("/", "layout")
  revalidatePath("/pengaturan")

  return {
    ok: true,
    message: "Identitas RT berhasil diperbarui.",
  }
}

export async function uploadTenantLogoAction(
  formData: FormData
): Promise<{ ok: boolean; logoUrl?: string; error?: string }> {
  const { tenant } = await requireAdminContext()

  if (!tenant.roles.includes("ketua_rt") && !tenant.roles.includes("sekretaris")) {
    return {
      ok: false,
      error: "Hanya Ketua RT atau Sekretaris yang dapat mengunggah logo.",
    }
  }

  const file = formData.get("logoFile")
  if (!file || !(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      error: "Pilih berkas gambar logo terlebih dahulu.",
    }
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "Format berkas tidak didukung. Gunakan PNG, JPEG, atau WebP.",
    }
  }

  if (file.size > MAX_LOGO_BYTES) {
    return {
      ok: false,
      error: "Ukuran berkas logo maksimal 2 MB.",
    }
  }

  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const magicMime = detectComplaintPhotoMimeFromBytes(bytes)
  if (!magicMime) {
    return {
      ok: false,
      error: "Isi berkas tidak valid atau bukan gambar (JPEG, PNG, WebP).",
    }
  }

  const extension = magicMime === "image/png" ? "png" : magicMime === "image/webp" ? "webp" : "jpg"
  const fileName = `logo_${Date.now()}.${extension}`
  const storagePath = `${tenant.tenantId}/${fileName}`

  const supabase = await createClient()
  const buffer = Buffer.from(arrayBuffer)

  const { error: uploadErr } = await supabase.storage
    .from("tenant-logos")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadErr) {
    return {
      ok: false,
      error: uploadErr.message || "Gagal mengunggah logo ke penyimpanan.",
    }
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("tenant-logos").getPublicUrl(storagePath)

  // Save the new logoUrl into tenant settings via RPC
  const currentIdentity = await getTenantIdentity(tenant.tenantId)
  if (currentIdentity) {
    await supabase.rpc("update_tenant_identity", {
      p_tenant_id: tenant.tenantId,
      p_name: currentIdentity.name,
      p_rt_number: currentIdentity.rtNumber,
      p_rw_number: currentIdentity.rwNumber,
      p_kelurahan: currentIdentity.kelurahan,
      p_kecamatan: currentIdentity.kecamatan,
      p_city: currentIdentity.city,
      p_province: currentIdentity.province,
      p_postal_code: currentIdentity.postalCode,
      p_logo_url: publicUrl,
    })
  }

  revalidatePath("/", "layout")
  revalidatePath("/pengaturan")

  return {
    ok: true,
    logoUrl: publicUrl,
  }
}

export async function removeTenantLogoAction(): Promise<{
  ok: boolean
  error?: string
}> {
  const { tenant } = await requireAdminContext()

  if (!tenant.roles.includes("ketua_rt") && !tenant.roles.includes("sekretaris")) {
    return {
      ok: false,
      error: "Hanya Ketua RT atau Sekretaris yang dapat menghapus logo.",
    }
  }

  const currentIdentity = await getTenantIdentity(tenant.tenantId)
  if (!currentIdentity) {
    return { ok: false, error: "Data tenant tidak ditemukan." }
  }

  const supabase = await createClient()

  // Update tenant settings to remove logo_url
  const { error: rpcErr } = await supabase.rpc("update_tenant_identity", {
    p_tenant_id: tenant.tenantId,
    p_name: currentIdentity.name,
    p_rt_number: currentIdentity.rtNumber,
    p_rw_number: currentIdentity.rwNumber,
    p_kelurahan: currentIdentity.kelurahan,
    p_kecamatan: currentIdentity.kecamatan,
    p_city: currentIdentity.city,
    p_province: currentIdentity.province,
    p_postal_code: currentIdentity.postalCode,
    p_logo_url: null,
  })

  if (rpcErr) {
    return { ok: false, error: rpcErr.message || "Gagal menghapus logo." }
  }

  revalidatePath("/", "layout")
  revalidatePath("/pengaturan")

  return { ok: true }
}

