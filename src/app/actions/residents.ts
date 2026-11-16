"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireAdminContext } from "@/lib/auth/guards"
import {
  createResidentSchema,
  softDeleteResidentSchema,
  updateHouseholdSchema,
  updateResidentSchema,
} from "@/lib/residents/schemas"
import {
  canManageResidents,
  type HouseholdFormActionState,
  type ResidentFormActionState,
} from "@/lib/residents/types"
import { createClient } from "@/lib/supabase/server"

function getStringField(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

function getBooleanField(formData: FormData, key: string): boolean {
  const values = formData.getAll(key)
  return values.some((v) => v === "true" || v === "on" || v === "1")
}

export async function createResidentAction(
  _prevState: ResidentFormActionState,
  formData: FormData
): Promise<ResidentFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageResidents(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk menambah data warga. Hanya Ketua RT atau Sekretaris yang dapat melakukan perubahan.",
    }
  }

  const parsed = createResidentSchema.safeParse({
    fullName: getStringField(formData, "fullName"),
    gender: getStringField(formData, "gender"),
    phone: getStringField(formData, "phone"),
    familyRole: getStringField(formData, "familyRole"),
    residencyStatus: getStringField(formData, "residencyStatus") || "aktif",
    stayStatus: getStringField(formData, "stayStatus") || "tetap",
    nik: getStringField(formData, "nik"),
    birthPlace: getStringField(formData, "birthPlace"),
    birthDate: getStringField(formData, "birthDate"),
    extraNotes: getStringField(formData, "extraNotes"),
    setAsHouseholdHead:
      getBooleanField(formData, "setAsHouseholdHead") ||
      getStringField(formData, "familyRole") === "kepala_keluarga",
    householdMode: getStringField(formData, "householdMode") || "existing",
    householdId: getStringField(formData, "householdId"),
    kkNumber: getStringField(formData, "kkNumber"),
    address: getStringField(formData, "address"),
    blockUnit: getStringField(formData, "blockUnit"),
    residenceStatus: getStringField(formData, "residenceStatus") || "tetap",
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali isian formulir yang masih belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()
  let targetHouseholdId = input.householdId ?? ""
  let createdHouseholdId: string | null = null

  if (input.householdMode === "existing") {
    const { data: existingHousehold } = await supabase
      .from("households")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", targetHouseholdId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!existingHousehold) {
      return {
        error: "Kartu Keluarga yang dipilih tidak ditemukan pada RT ini.",
        fieldErrors: {
          householdId: ["Pilih Kartu Keluarga yang valid di RT aktif."],
        },
      }
    }
  } else {
    const { data: newHousehold, error: householdError } = await supabase
      .from("households")
      .insert({
        tenant_id: tenant.tenantId,
        kk_number: input.kkNumber!,
        address: input.address!,
        block_unit: input.blockUnit,
        residence_status: input.residenceStatus,
        status: "active",
        head_resident_id: null,
      })
      .select("id")
      .single()

    if (householdError || !newHousehold) {
      if (householdError?.code === "23505") {
        return {
          error: "Nomor KK sudah terdaftar aktif di RT ini.",
          fieldErrors: {
            kkNumber: ["Nomor KK sudah terdaftar aktif di RT ini."],
          },
        }
      }
      return {
        error:
          householdError?.code === "42501"
            ? "Anda tidak memiliki izin database untuk membuat Kartu Keluarga baru."
            : "Gagal menyimpan data Kartu Keluarga baru. Silakan coba lagi.",
      }
    }

    targetHouseholdId = (newHousehold as { id: string }).id
    createdHouseholdId = targetHouseholdId
  }

  const { data: newResident, error: residentError } = await supabase
    .from("residents")
    .insert({
      tenant_id: tenant.tenantId,
      household_id: targetHouseholdId,
      full_name: input.fullName,
      gender: input.gender,
      phone: input.phone,
      family_role: input.familyRole,
      residency_status: input.residencyStatus,
      stay_status: input.stayStatus,
    })
    .select("id")
    .single()

  if (residentError || !newResident) {
    if (createdHouseholdId) {
      await supabase
        .from("households")
        .delete()
        .eq("id", createdHouseholdId)
        .eq("tenant_id", tenant.tenantId)
    }

    return {
      error:
        residentError?.code === "42501"
          ? "Anda tidak memiliki izin database untuk menambah warga."
          : "Gagal menyimpan data warga. Perubahan dibatalkan agar data tetap konsisten.",
    }
  }

  const createdResidentId = (newResident as { id: string }).id

  const { error: privateError } = await supabase
    .from("resident_private_data")
    .insert({
      tenant_id: tenant.tenantId,
      resident_id: createdResidentId,
      nik: input.nik,
      birth_place: input.birthPlace,
      birth_date: input.birthDate,
      extra_notes: input.extraNotes,
    })

  if (privateError) {
    await supabase
      .from("residents")
      .delete()
      .eq("id", createdResidentId)
      .eq("tenant_id", tenant.tenantId)

    if (createdHouseholdId) {
      await supabase
        .from("households")
        .delete()
        .eq("id", createdHouseholdId)
        .eq("tenant_id", tenant.tenantId)
    }

    if (privateError.code === "23505") {
      return {
        error: "NIK tersebut sudah terdaftar pada warga lain di RT ini.",
        fieldErrors: {
          nik: ["NIK sudah terdaftar pada warga lain di RT ini."],
        },
      }
    }

    return {
      error:
        "Gagal menyimpan data kependudukan (NIK/kelahiran). Data warga baru dibatalkan.",
    }
  }

  if (input.setAsHouseholdHead) {
    await supabase
      .from("households")
      .update({ head_resident_id: createdResidentId })
      .eq("id", targetHouseholdId)
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
  }

  revalidatePath("/residents")
  redirect(`/residents/${createdResidentId}?created=1`)
}

export async function updateResidentAction(
  _prevState: ResidentFormActionState,
  formData: FormData
): Promise<ResidentFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageResidents(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk mengubah data warga. Hanya Ketua RT atau Sekretaris yang dapat melakukan perubahan.",
    }
  }

  const parsed = updateResidentSchema.safeParse({
    residentId: getStringField(formData, "residentId"),
    householdId: getStringField(formData, "householdId"),
    fullName: getStringField(formData, "fullName"),
    gender: getStringField(formData, "gender"),
    phone: getStringField(formData, "phone"),
    familyRole: getStringField(formData, "familyRole"),
    residencyStatus: getStringField(formData, "residencyStatus"),
    stayStatus: getStringField(formData, "stayStatus"),
    setAsHouseholdHead: getBooleanField(formData, "setAsHouseholdHead"),
    nik: getStringField(formData, "nik"),
    birthPlace: getStringField(formData, "birthPlace"),
    birthDate: getStringField(formData, "birthDate"),
    extraNotes: getStringField(formData, "extraNotes"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali isian formulir yang masih belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: existingResident } = await supabase
    .from("residents")
    .select("id, household_id")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.residentId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!existingResident) {
    return {
      error: "Data warga tidak ditemukan atau sudah diarsipkan.",
    }
  }

  const { data: targetHousehold } = await supabase
    .from("households")
    .select("id, head_resident_id")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.householdId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!targetHousehold) {
    return {
      error: "Kartu Keluarga tujuan tidak ditemukan di RT aktif ini.",
      fieldErrors: {
        householdId: ["Kartu Keluarga tidak valid untuk RT ini."],
      },
    }
  }

  const { error: residentUpdateError } = await supabase
    .from("residents")
    .update({
      household_id: input.householdId,
      full_name: input.fullName,
      gender: input.gender,
      phone: input.phone,
      family_role: input.familyRole,
      residency_status: input.residencyStatus,
      stay_status: input.stayStatus,
    })
    .eq("id", input.residentId)
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)

  if (residentUpdateError) {
    return {
      error: "Gagal memperbarui profil warga. Silakan coba lagi.",
    }
  }

  const hasPrivatePayload = Boolean(
    input.nik && input.birthPlace && input.birthDate
  )

  if (hasPrivatePayload) {
    const { data: existingPrivate } = await supabase
      .from("resident_private_data")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .eq("resident_id", input.residentId)
      .is("deleted_at", null)
      .maybeSingle()

    const privateMutation = existingPrivate
      ? await supabase
          .from("resident_private_data")
          .update({
            nik: input.nik,
            birth_place: input.birthPlace,
            birth_date: input.birthDate,
            extra_notes: input.extraNotes,
          })
          .eq("id", (existingPrivate as { id: string }).id)
          .eq("tenant_id", tenant.tenantId)
      : await supabase.from("resident_private_data").insert({
          tenant_id: tenant.tenantId,
          resident_id: input.residentId,
          nik: input.nik,
          birth_place: input.birthPlace,
          birth_date: input.birthDate,
          extra_notes: input.extraNotes,
        })

    if (privateMutation.error) {
      if (privateMutation.error.code === "23505") {
        return {
          error: "NIK tersebut sudah terdaftar pada warga lain di RT ini.",
          fieldErrors: {
            nik: ["NIK sudah digunakan oleh warga lain di RT ini."],
          },
        }
      }
      return {
        error: "Profil dasar tersimpan, namun gagal memperbarui data NIK/kelahiran.",
      }
    }
  }

  const previousHouseholdId = (existingResident as { household_id: string })
    .household_id

  if (input.setAsHouseholdHead) {
    await supabase
      .from("households")
      .update({ head_resident_id: input.residentId })
      .eq("id", input.householdId)
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
  }

  if (!input.setAsHouseholdHead || previousHouseholdId !== input.householdId) {
    await supabase
      .from("households")
      .update({ head_resident_id: null })
      .eq("id", previousHouseholdId)
      .eq("tenant_id", tenant.tenantId)
      .eq("head_resident_id", input.residentId)
      .is("deleted_at", null)
  }

  revalidatePath("/residents")
  revalidatePath(`/residents/${input.residentId}`)
  redirect(`/residents/${input.residentId}?updated=1`)
}

export async function updateHouseholdAction(
  _prevState: HouseholdFormActionState,
  formData: FormData
): Promise<HouseholdFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageResidents(tenant.roles)) {
    return {
      error:
        "Hanya Ketua RT atau Sekretaris yang dapat mengubah data Kartu Keluarga.",
    }
  }

  const parsed = updateHouseholdSchema.safeParse({
    householdId: getStringField(formData, "householdId"),
    kkNumber: getStringField(formData, "kkNumber"),
    address: getStringField(formData, "address"),
    blockUnit: getStringField(formData, "blockUnit"),
    residenceStatus: getStringField(formData, "residenceStatus"),
    status: getStringField(formData, "status"),
    headResidentId: getStringField(formData, "headResidentId"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali isian Kartu Keluarga.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: existingHousehold } = await supabase
    .from("households")
    .select("id")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.householdId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!existingHousehold) {
    return {
      error: "Data Kartu Keluarga tidak ditemukan di RT ini.",
    }
  }

  if (input.headResidentId) {
    const { data: memberResident } = await supabase
      .from("residents")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .eq("household_id", input.householdId)
      .eq("id", input.headResidentId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!memberResident) {
      return {
        error: "Kepala keluarga harus merupakan anggota aktif dari Kartu Keluarga ini.",
        fieldErrors: {
          headResidentId: [
            "Pilih anggota aktif dari Kartu Keluarga ini.",
          ],
        },
      }
    }
  }

  const { error: updateError } = await supabase
    .from("households")
    .update({
      kk_number: input.kkNumber,
      address: input.address,
      block_unit: input.blockUnit,
      residence_status: input.residenceStatus,
      status: input.status,
      head_resident_id: input.headResidentId,
    })
    .eq("id", input.householdId)
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)

  if (updateError) {
    if (updateError.code === "23505") {
      return {
        error: "Nomor KK sudah terdaftar aktif pada Kartu Keluarga lain.",
        fieldErrors: {
          kkNumber: ["Nomor KK sudah digunakan pada Kartu Keluarga lain."],
        },
      }
    }
    return {
      error: "Gagal memperbarui data Kartu Keluarga. Silakan coba lagi.",
    }
  }

  revalidatePath("/residents")
  return {
    error: null,
    successMessage: "Data Kartu Keluarga berhasil diperbarui.",
  }
}

export async function softDeleteResidentAction(
  formData: FormData
): Promise<ResidentFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageResidents(tenant.roles)) {
    return {
      error:
        "Hanya Ketua RT atau Sekretaris yang dapat menonaktifkan/mengarsipkan data warga.",
    }
  }

  const parsed = softDeleteResidentSchema.safeParse({
    residentId: getStringField(formData, "residentId"),
  })

  if (!parsed.success) {
    return {
      error: "ID warga tidak valid.",
    }
  }

  const { residentId } = parsed.data
  const supabase = await createClient()

  const { data: existingResident } = await supabase
    .from("residents")
    .select("id, household_id")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", residentId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!existingResident) {
    return {
      error: "Data warga tidak ditemukan atau sudah diarsipkan.",
    }
  }

  const nowIso = new Date().toISOString()

  await supabase
    .from("households")
    .update({ head_resident_id: null })
    .eq("tenant_id", tenant.tenantId)
    .eq("id", (existingResident as { household_id: string }).household_id)
    .eq("head_resident_id", residentId)
    .is("deleted_at", null)

  await supabase
    .from("resident_private_data")
    .update({ deleted_at: nowIso })
    .eq("tenant_id", tenant.tenantId)
    .eq("resident_id", residentId)
    .is("deleted_at", null)

  const { error: deleteError } = await supabase
    .from("residents")
    .update({
      deleted_at: nowIso,
      residency_status: "nonaktif",
    })
    .eq("tenant_id", tenant.tenantId)
    .eq("id", residentId)
    .is("deleted_at", null)

  if (deleteError) {
    return {
      error: "Gagal mengarsipkan data warga. Silakan coba lagi.",
    }
  }

  revalidatePath("/residents")
  redirect("/residents?archived=1")
}
