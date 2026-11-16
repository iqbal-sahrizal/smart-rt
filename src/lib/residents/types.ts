import type { RoleCode } from "@/lib/auth/types"

export type Gender = "L" | "P"
export type FamilyRole = "kepala_keluarga" | "istri" | "anak" | "famili_lain"
export type ResidencyStatus = "aktif" | "pindah" | "meninggal" | "nonaktif"
export type StayStatus = "tetap" | "kontrak" | "kos" | "lainnya"
export type HouseholdStatus = "active" | "inactive"
export type VehicleType = "motor" | "mobil" | "lainnya"
export type ResidentDocumentType = "ktp" | "kk" | "akta" | "domisili" | "lainnya"

export const GENDER_LABELS: Record<Gender, string> = {
  L: "Laki-laki",
  P: "Perempuan",
}

export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = {
  kepala_keluarga: "Kepala Keluarga",
  istri: "Istri",
  anak: "Anak",
  famili_lain: "Famili Lain",
}

export const RESIDENCY_STATUS_LABELS: Record<ResidencyStatus, string> = {
  aktif: "Aktif",
  pindah: "Pindah",
  meninggal: "Meninggal",
  nonaktif: "Nonaktif",
}

export const STAY_STATUS_LABELS: Record<StayStatus, string> = {
  tetap: "Tetap",
  kontrak: "Kontrak",
  kos: "Kos",
  lainnya: "Lainnya",
}

export const HOUSEHOLD_STATUS_LABELS: Record<HouseholdStatus, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
}

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  motor: "Sepeda Motor",
  mobil: "Mobil",
  lainnya: "Lainnya",
}

export const DOCUMENT_TYPE_LABELS: Record<ResidentDocumentType, string> = {
  ktp: "KTP",
  kk: "Kartu Keluarga",
  akta: "Akta Lahir / Nikah",
  domisili: "Surat Domisili",
  lainnya: "Lainnya",
}

export const RESIDENT_MANAGEMENT_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
]

export function canManageResidents(roleCodes: readonly RoleCode[]): boolean {
  return roleCodes.some((role) => RESIDENT_MANAGEMENT_ROLES.includes(role))
}

export function canViewSensitiveResidentData(
  roleCodes: readonly RoleCode[]
): boolean {
  return roleCodes.some((role) => RESIDENT_MANAGEMENT_ROLES.includes(role))
}

export function getResidencyStatusBadgeVariant(
  status: ResidencyStatus
): "success" | "info" | "warning" | "outline" {
  switch (status) {
    case "aktif":
      return "success"
    case "pindah":
      return "warning"
    case "meninggal":
      return "outline"
    case "nonaktif":
      return "outline"
  }
}

export function getHouseholdStatusBadgeVariant(
  status: HouseholdStatus
): "success" | "outline" {
  return status === "active" ? "success" : "outline"
}

export interface HouseholdSummary {
  id: string
  tenantId: string
  kkNumber: string
  headResidentId: string | null
  address: string
  blockUnit: string | null
  residenceStatus: StayStatus
  status: HouseholdStatus
  createdAt: string
  updatedAt: string
}

export interface ResidentSummary {
  id: string
  tenantId: string
  householdId: string
  fullName: string
  gender: Gender
  phone: string | null
  familyRole: FamilyRole
  residencyStatus: ResidencyStatus
  stayStatus: StayStatus
  createdAt: string
  updatedAt: string
}

export interface ResidentDirectoryItem extends ResidentSummary {
  household: Pick<
    HouseholdSummary,
    "id" | "blockUnit" | "address" | "residenceStatus" | "status" | "headResidentId"
  > | null
}

export interface ResidentPrivateData {
  id: string
  tenantId: string
  residentId: string
  nik: string
  birthPlace: string
  birthDate: string
  extraNotes: string | null
  createdAt: string
  updatedAt: string
}

export interface ResidentDocumentSummary {
  id: string
  documentType: ResidentDocumentType
  mimeType: string
  fileSizeBytes: number
  verifiedAt: string | null
  createdAt: string
}

export interface VehicleSummary {
  id: string
  householdId: string
  residentId: string | null
  vehicleType: VehicleType
  plateNumber: string
  brandModel: string | null
  color: string | null
}

export interface ResidentFormActionState {
  error: string | null
  fieldErrors?: Record<string, string[] | undefined>
}

export interface HouseholdFormActionState {
  error: string | null
  successMessage?: string | null
  fieldErrors?: Record<string, string[] | undefined>
}

