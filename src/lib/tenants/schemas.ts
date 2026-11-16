import { z } from "zod"

export interface TenantIdentity {
  id: string
  code: string
  name: string
  rtNumber: string
  rwNumber: string
  kelurahan: string
  kecamatan: string
  city: string
  province: string
  postalCode: string | null
  logoUrl: string | null
  status: string
  updatedAt: string
}

export const tenantIdentitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Nama RT / Organisasi minimal 3 karakter.")
    .max(100, "Nama RT / Organisasi maksimal 100 karakter."),
  rtNumber: z
    .string()
    .trim()
    .min(1, "Nomor RT wajib diisi.")
    .max(5, "Nomor RT maksimal 5 karakter.")
    .regex(/^[0-9]+$/, "Nomor RT hanya boleh berupa angka."),
  rwNumber: z
    .string()
    .trim()
    .min(1, "Nomor RW wajib diisi.")
    .max(5, "Nomor RW maksimal 5 karakter.")
    .regex(/^[0-9]+$/, "Nomor RW hanya boleh berupa angka."),
  kelurahan: z
    .string()
    .trim()
    .min(2, "Kelurahan / Desa minimal 2 karakter.")
    .max(100, "Kelurahan / Desa maksimal 100 karakter."),
  kecamatan: z
    .string()
    .trim()
    .min(2, "Kecamatan minimal 2 karakter.")
    .max(100, "Kecamatan maksimal 100 karakter."),
  city: z
    .string()
    .trim()
    .min(2, "Kabupaten / Kota minimal 2 karakter.")
    .max(100, "Kabupaten / Kota maksimal 100 karakter."),
  province: z
    .string()
    .trim()
    .min(2, "Provinsi minimal 2 karakter.")
    .max(100, "Provinsi maksimal 100 karakter."),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9]{5}$/, "Kode Pos harus 5 digit angka.")
    .or(z.literal("")),
  logoUrl: z.string().trim().url("URL logo tidak valid.").or(z.literal("")),
})

export type TenantIdentityInput = z.infer<typeof tenantIdentitySchema>

