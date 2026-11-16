import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"

const tenantIdentitySchema = z.object({
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

test("tenantIdentitySchema parses valid tenant data correctly", () => {
  const input = {
    name: "RT 01 / RW 01 Staging",
    rtNumber: "01",
    rwNumber: "01",
    kelurahan: "Kelurahan Simulasi",
    kecamatan: "Kecamatan Simulasi",
    city: "Kota Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "12345",
    logoUrl: "https://szghujzhiyndeuhepsax.supabase.co/storage/v1/object/public/tenant-logos/sample.png",
  }

  const result = tenantIdentitySchema.safeParse(input)
  assert.equal(result.success, true)
  if (result.success) {
    assert.equal(result.data.name, "RT 01 / RW 01 Staging")
    assert.equal(result.data.rtNumber, "01")
    assert.equal(result.data.postalCode, "12345")
  }
})

test("tenantIdentitySchema allows empty optional fields (postalCode, logoUrl)", () => {
  const input = {
    name: "RT 05 / RW 02 Kebayoran",
    rtNumber: "05",
    rwNumber: "02",
    kelurahan: "Kebayoran Lama",
    kecamatan: "Kebayoran",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "",
    logoUrl: "",
  }

  const result = tenantIdentitySchema.safeParse(input)
  assert.equal(result.success, true)
})

test("tenantIdentitySchema rejects non-numeric RT/RW numbers", () => {
  const input = {
    name: "RT 01 / RW 01 Staging",
    rtNumber: "01A",
    rwNumber: "RW1",
    kelurahan: "Kelurahan Simulasi",
    kecamatan: "Kecamatan Simulasi",
    city: "Kota Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "",
    logoUrl: "",
  }

  const result = tenantIdentitySchema.safeParse(input)
  assert.equal(result.success, false)
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors
    assert.ok(errors.rtNumber)
    assert.ok(errors.rwNumber)
  }
})

test("tenantIdentitySchema rejects invalid postal codes", () => {
  const input = {
    name: "RT 01 / RW 01 Staging",
    rtNumber: "01",
    rwNumber: "01",
    kelurahan: "Kelurahan Simulasi",
    kecamatan: "Kecamatan Simulasi",
    city: "Kota Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "1234", // 4 digits instead of 5
    logoUrl: "",
  }

  const result = tenantIdentitySchema.safeParse(input)
  assert.equal(result.success, false)
  if (!result.success) {
    assert.ok(result.error.flatten().fieldErrors.postalCode)
  }
})

test("tenantIdentitySchema rejects invalid logoUrl", () => {
  const input = {
    name: "RT 01 / RW 01 Staging",
    rtNumber: "01",
    rwNumber: "01",
    kelurahan: "Kelurahan Simulasi",
    kecamatan: "Kecamatan Simulasi",
    city: "Kota Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "12345",
    logoUrl: "not-a-valid-url",
  }

  const result = tenantIdentitySchema.safeParse(input)
  assert.equal(result.success, false)
  if (!result.success) {
    assert.ok(result.error.flatten().fieldErrors.logoUrl)
  }
})

test("Storage path regex matches expected tenant-logos path pattern", () => {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp)$/

  const validPath = "d2e09c1a-24a0-4700-8029-ebb934d27de8/logo_1731770000000.png"
  const invalidBucket = "other-bucket/d2e09c1a-24a0-4700-8029-ebb934d27de8/logo.png"
  const invalidExt = "d2e09c1a-24a0-4700-8029-ebb934d27de8/logo.exe"

  assert.equal(pattern.test(validPath), true)
  assert.equal(pattern.test(invalidBucket), false)
  assert.equal(pattern.test(invalidExt), false)
})

test("tenantIdentitySchema strips unpermitted / spoofed fields", () => {
  const input = {
    name: "RT 01 / RW 01 Staging",
    rtNumber: "01",
    rwNumber: "01",
    kelurahan: "Kelurahan Simulasi",
    kecamatan: "Kecamatan Simulasi",
    city: "Kota Jakarta Selatan",
    province: "DKI Jakarta",
    postalCode: "12345",
    logoUrl: "https://example.com/logo.png",
    // Spoofed fields that should not exist in parsed output
    id: "hacked-id",
    tenantId: "spoofed-tenant-id",
    role: "super_admin",
  }

  const result = tenantIdentitySchema.safeParse(input)
  assert.equal(result.success, true)
  if (result.success) {
    const data = result.data
    assert.equal(data.id, undefined)
    assert.equal(data.tenantId, undefined)
    assert.equal(data.role, undefined)
  }
})

test("Role permission rules: only ketua_rt and sekretaris are authorized to update tenant settings", () => {
  const canManageTenant = (roles) =>
    roles.includes("ketua_rt") || roles.includes("sekretaris")

  assert.equal(canManageTenant(["ketua_rt"]), true)
  assert.equal(canManageTenant(["sekretaris"]), true)
  assert.equal(canManageTenant(["ketua_rt", "warga"]), true)
  assert.equal(canManageTenant(["bendahara"]), false)
  assert.equal(canManageTenant(["warga"]), false)
  assert.equal(canManageTenant([]), false)
})


