import "server-only"

import type { RoleCode } from "@/lib/auth/types"
import { isValidUuid } from "@/lib/residents/schemas"
import {
  canViewSensitiveResidentData,
  type FamilyRole,
  type Gender,
  type HouseholdStatus,
  type HouseholdSummary,
  type ResidencyStatus,
  type ResidentDirectoryItem,
  type ResidentDocumentSummary,
  type ResidentDocumentType,
  type ResidentPrivateData,
  type ResidentSummary,
  type StayStatus,
  type VehicleSummary,
  type VehicleType,
} from "@/lib/residents/types"
import { createClient } from "@/lib/supabase/server"

interface RawHouseholdRow {
  id: string
  tenant_id: string
  kk_number: string
  head_resident_id: string | null
  address: string
  block_unit: string | null
  residence_status: StayStatus
  status: HouseholdStatus
  created_at: string
  updated_at: string
}

interface RawResidentRow {
  id: string
  tenant_id: string
  household_id: string
  full_name: string
  gender: Gender
  phone: string | null
  family_role: FamilyRole
  residency_status: ResidencyStatus
  stay_status: StayStatus
  created_at: string
  updated_at: string
}

interface RawPrivateDataRow {
  id: string
  tenant_id: string
  resident_id: string
  nik: string
  birth_place: string
  birth_date: string
  extra_notes: string | null
  created_at: string
  updated_at: string
}

interface RawDocumentRow {
  id: string
  document_type: ResidentDocumentType
  mime_type: string
  file_size_bytes: number
  verified_at: string | null
  created_at: string
}

interface RawVehicleRow {
  id: string
  household_id: string
  resident_id: string | null
  vehicle_type: VehicleType
  plate_number: string
  brand_model: string | null
  color: string | null
}

function mapHousehold(row: RawHouseholdRow): HouseholdSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kkNumber: row.kk_number,
    headResidentId: row.head_resident_id,
    address: row.address,
    blockUnit: row.block_unit,
    residenceStatus: row.residence_status,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapResident(row: RawResidentRow): ResidentSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    householdId: row.household_id,
    fullName: row.full_name,
    gender: row.gender,
    phone: row.phone,
    familyRole: row.family_role,
    residencyStatus: row.residency_status,
    stayStatus: row.stay_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapPrivateData(row: RawPrivateDataRow): ResidentPrivateData {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    residentId: row.resident_id,
    nik: row.nik,
    birthPlace: row.birth_place,
    birthDate: row.birth_date,
    extraNotes: row.extra_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function sanitizeSearchTerm(input: string | undefined): string {
  if (!input) return ""
  return input
    .trim()
    .replace(/[,()%*\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

export interface HouseholdOption {
  id: string
  kkNumber: string
  blockUnit: string | null
  address: string
  residenceStatus: StayStatus
  status: HouseholdStatus
  headResidentId: string | null
}

export interface AdminResidentsDirectoryParams {
  tenantId: string
  search?: string
  status?: string
  householdId?: string
  page?: number
  pageSize?: number
}

export interface AdminResidentsDirectoryResult {
  items: ResidentDirectoryItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  householdOptions: HouseholdOption[]
  selectedHousehold: HouseholdSummary | null
  selectedHouseholdMembers: ResidentSummary[]
  error: string | null
}

const VALID_RESIDENCY_STATUSES = new Set<ResidencyStatus>([
  "aktif",
  "pindah",
  "meninggal",
  "nonaktif",
])

export async function getAdminResidentsDirectory({
  tenantId,
  search,
  status,
  householdId,
  page = 1,
  pageSize = 10,
}: AdminResidentsDirectoryParams): Promise<AdminResidentsDirectoryResult> {
  const supabase = await createClient()
  const cleanSearch = sanitizeSearchTerm(search)
  const validStatus =
    status && VALID_RESIDENCY_STATUSES.has(status as ResidencyStatus)
      ? (status as ResidencyStatus)
      : null
  const validHouseholdId =
    householdId && isValidUuid(householdId) ? householdId : null
  const safePageSize = Math.min(Math.max(pageSize, 1), 50)
  const requestedPage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1

  const { data: householdRows, error: householdsError } = await supabase
    .from("households")
    .select(
      "id, tenant_id, kk_number, head_resident_id, address, block_unit, residence_status, status, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("block_unit", { ascending: true, nullsFirst: false })
    .order("address", { ascending: true })

  if (householdsError) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      householdOptions: [],
      selectedHousehold: null,
      selectedHouseholdMembers: [],
      error: "Gagal memuat daftar warga dan kartu keluarga.",
    }
  }

  const households = ((householdRows ?? []) as RawHouseholdRow[]).map(
    mapHousehold
  )
  const householdsById = new Map(households.map((item) => [item.id, item]))
  const householdOptions: HouseholdOption[] = households.map((item) => ({
    id: item.id,
    kkNumber: item.kkNumber,
    blockUnit: item.blockUnit,
    address: item.address,
    residenceStatus: item.residenceStatus,
    status: item.status,
    headResidentId: item.headResidentId,
  }))

  let query = supabase
    .from("residents")
    .select(
      "id, tenant_id, household_id, full_name, gender, phone, family_role, residency_status, stay_status, created_at, updated_at",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  if (validStatus) {
    query = query.eq("residency_status", validStatus)
  }

  if (validHouseholdId) {
    query = query.eq("household_id", validHouseholdId)
  }

  if (cleanSearch) {
    const lowerSearch = cleanSearch.toLowerCase()
    const matchedHouseholdIds = households
      .filter(
        (h) =>
          (h.blockUnit && h.blockUnit.toLowerCase().includes(lowerSearch)) ||
          h.address.toLowerCase().includes(lowerSearch)
      )
      .map((h) => h.id)

    if (matchedHouseholdIds.length > 0) {
      query = query.or(
        `full_name.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%,household_id.in.(${matchedHouseholdIds.join(",")})`
      )
    } else {
      query = query.or(
        `full_name.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%`
      )
    }
  }

  const from = (requestedPage - 1) * safePageSize
  const to = from + safePageSize - 1

  const {
    data: residentRows,
    count,
    error: residentsError,
  } = await query
    .order("full_name", { ascending: true })
    .range(from, to)

  if (residentsError) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      householdOptions,
      selectedHousehold: null,
      selectedHouseholdMembers: [],
      error: "Gagal memuat daftar warga.",
    }
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const currentPage = Math.min(requestedPage, totalPages)

  let finalRows = (residentRows ?? []) as RawResidentRow[]
  if (requestedPage > totalPages && totalCount > 0) {
    const correctedFrom = (currentPage - 1) * safePageSize
    const correctedTo = correctedFrom + safePageSize - 1
    let retryQuery = supabase
      .from("residents")
      .select(
        "id, tenant_id, household_id, full_name, gender, phone, family_role, residency_status, stay_status, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)

    if (validStatus) retryQuery = retryQuery.eq("residency_status", validStatus)
    if (validHouseholdId) {
      retryQuery = retryQuery.eq("household_id", validHouseholdId)
    }
    if (cleanSearch) {
      retryQuery = retryQuery.or(
        `full_name.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%`
      )
    }
    const retryRes = await retryQuery
      .order("full_name", { ascending: true })
      .range(correctedFrom, correctedTo)
    finalRows = (retryRes.data ?? []) as RawResidentRow[]
  }

  const items: ResidentDirectoryItem[] = finalRows.map((row) => {
    const household = householdsById.get(row.household_id)
    return {
      ...mapResident(row),
      household: household
        ? {
            id: household.id,
            blockUnit: household.blockUnit,
            address: household.address,
            residenceStatus: household.residenceStatus,
            status: household.status,
            headResidentId: household.headResidentId,
          }
        : null,
    }
  })

  let selectedHousehold: HouseholdSummary | null = null
  let selectedHouseholdMembers: ResidentSummary[] = []
  if (validHouseholdId) {
    selectedHousehold = householdsById.get(validHouseholdId) ?? null
    if (selectedHousehold) {
      const { data: memberRows } = await supabase
        .from("residents")
        .select(
          "id, tenant_id, household_id, full_name, gender, phone, family_role, residency_status, stay_status, created_at, updated_at"
        )
        .eq("tenant_id", tenantId)
        .eq("household_id", validHouseholdId)
        .is("deleted_at", null)
        .order("family_role", { ascending: true })
        .order("full_name", { ascending: true })

      selectedHouseholdMembers = ((memberRows ?? []) as RawResidentRow[]).map(
        mapResident
      )
    }
  }

  return {
    items,
    totalCount,
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    householdOptions,
    selectedHousehold,
    selectedHouseholdMembers,
    error: null,
  }
}

export async function getTenantHouseholdOptions(
  tenantId: string
): Promise<HouseholdOption[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("households")
    .select(
      "id, kk_number, block_unit, address, residence_status, status, head_resident_id"
    )
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("block_unit", { ascending: true, nullsFirst: false })
    .order("address", { ascending: true })

  return ((data ?? []) as Array<{
    id: string
    kk_number: string
    block_unit: string | null
    address: string
    residence_status: StayStatus
    status: HouseholdStatus
    head_resident_id: string | null
  }>).map((item) => ({
    id: item.id,
    kkNumber: item.kk_number,
    blockUnit: item.block_unit,
    address: item.address,
    residenceStatus: item.residence_status,
    status: item.status,
    headResidentId: item.head_resident_id,
  }))
}

export interface AdminResidentDetailResult {
  resident: ResidentSummary
  household: HouseholdSummary | null
  householdMembers: ResidentSummary[]
  vehicles: VehicleSummary[]
  sensitiveAccessAllowed: boolean
  privateData: ResidentPrivateData | null
  documents: ResidentDocumentSummary[]
}

export async function getAdminResidentDetail({
  tenantId,
  residentId,
  roleCodes,
}: {
  tenantId: string
  residentId: string
  roleCodes: readonly RoleCode[]
}): Promise<AdminResidentDetailResult | null> {
  if (!isValidUuid(residentId)) {
    return null
  }

  const supabase = await createClient()
  const { data: residentRow, error: residentError } = await supabase
    .from("residents")
    .select(
      "id, tenant_id, household_id, full_name, gender, phone, family_role, residency_status, stay_status, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", residentId)
    .is("deleted_at", null)
    .maybeSingle()

  if (residentError || !residentRow) {
    return null
  }

  const resident = mapResident(residentRow as RawResidentRow)
  const sensitiveAccessAllowed = canViewSensitiveResidentData(roleCodes)

  const [householdRes, membersRes, vehiclesRes] = await Promise.all([
    supabase
      .from("households")
      .select(
        "id, tenant_id, kk_number, head_resident_id, address, block_unit, residence_status, status, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .eq("id", resident.householdId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("residents")
      .select(
        "id, tenant_id, household_id, full_name, gender, phone, family_role, residency_status, stay_status, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .eq("household_id", resident.householdId)
      .is("deleted_at", null)
      .order("family_role", { ascending: true })
      .order("full_name", { ascending: true }),
    supabase
      .from("vehicles")
      .select(
        "id, household_id, resident_id, vehicle_type, plate_number, brand_model, color"
      )
      .eq("tenant_id", tenantId)
      .eq("household_id", resident.householdId)
      .order("created_at", { ascending: true }),
  ])

  let privateData: ResidentPrivateData | null = null
  let documents: ResidentDocumentSummary[] = []

  // Only execute sensitive PII queries for roles authorized by RLS (ketua_rt, sekretaris).
  if (sensitiveAccessAllowed) {
    const [privateRes, docsRes] = await Promise.all([
      supabase
        .from("resident_private_data")
        .select(
          "id, tenant_id, resident_id, nik, birth_place, birth_date, extra_notes, created_at, updated_at"
        )
        .eq("tenant_id", tenantId)
        .eq("resident_id", resident.id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("resident_documents")
        .select("id, document_type, mime_type, file_size_bytes, verified_at, created_at")
        .eq("tenant_id", tenantId)
        .eq("resident_id", resident.id)
        .order("created_at", { ascending: false }),
    ])

    if (privateRes.data) {
      privateData = mapPrivateData(privateRes.data as RawPrivateDataRow)
    }

    documents = ((docsRes.data ?? []) as RawDocumentRow[]).map((doc) => ({
      id: doc.id,
      documentType: doc.document_type,
      mimeType: doc.mime_type,
      fileSizeBytes: doc.file_size_bytes,
      verifiedAt: doc.verified_at,
      createdAt: doc.created_at,
    }))
  }

  return {
    resident,
    household: householdRes.data
      ? mapHousehold(householdRes.data as RawHouseholdRow)
      : null,
    householdMembers: ((membersRes.data ?? []) as RawResidentRow[]).map(
      mapResident
    ),
    vehicles: ((vehiclesRes.data ?? []) as RawVehicleRow[]).map((v) => ({
      id: v.id,
      householdId: v.household_id,
      residentId: v.resident_id,
      vehicleType: v.vehicle_type,
      plateNumber: v.plate_number,
      brandModel: v.brand_model,
      color: v.color,
    })),
    sensitiveAccessAllowed,
    privateData,
    documents,
  }
}

export interface ResidentPortalData {
  linked: boolean
  resident: ResidentSummary | null
  privateData: ResidentPrivateData | null
  documents: ResidentDocumentSummary[]
  household: HouseholdSummary | null
  householdMembers: ResidentSummary[]
  vehicles: VehicleSummary[]
}

export async function getResidentPortalData({
  tenantId,
  userId,
  includePrivateProfile = false,
}: {
  tenantId: string
  userId: string
  includePrivateProfile?: boolean
}): Promise<ResidentPortalData> {
  const supabase = await createClient()

  const { data: memberRow } = await supabase
    .from("tenant_members")
    .select("resident_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  const residentId =
    (memberRow as { resident_id: string | null } | null)?.resident_id ?? null

  if (!residentId) {
    return {
      linked: false,
      resident: null,
      privateData: null,
      documents: [],
      household: null,
      householdMembers: [],
      vehicles: [],
    }
  }

  const { data: residentRow } = await supabase
    .from("residents")
    .select(
      "id, tenant_id, household_id, full_name, gender, phone, family_role, residency_status, stay_status, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", residentId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!residentRow) {
    return {
      linked: false,
      resident: null,
      privateData: null,
      documents: [],
      household: null,
      householdMembers: [],
      vehicles: [],
    }
  }

  const resident = mapResident(residentRow as RawResidentRow)

  const [householdRes, membersRes, vehiclesRes] = await Promise.all([
    supabase
      .from("households")
      .select(
        "id, tenant_id, kk_number, head_resident_id, address, block_unit, residence_status, status, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .eq("id", resident.householdId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("residents")
      .select(
        "id, tenant_id, household_id, full_name, gender, phone, family_role, residency_status, stay_status, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .eq("household_id", resident.householdId)
      .is("deleted_at", null)
      .order("family_role", { ascending: true })
      .order("full_name", { ascending: true }),
    supabase
      .from("vehicles")
      .select(
        "id, household_id, resident_id, vehicle_type, plate_number, brand_model, color"
      )
      .eq("tenant_id", tenantId)
      .eq("household_id", resident.householdId)
      .order("created_at", { ascending: true }),
  ])

  let privateData: ResidentPrivateData | null = null
  let documents: ResidentDocumentSummary[] = []

  // Strictly only fetch the caller's OWN resident_private_data & documents on profile view.
  if (includePrivateProfile) {
    const [privateRes, docsRes] = await Promise.all([
      supabase
        .from("resident_private_data")
        .select(
          "id, tenant_id, resident_id, nik, birth_place, birth_date, extra_notes, created_at, updated_at"
        )
        .eq("tenant_id", tenantId)
        .eq("resident_id", resident.id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("resident_documents")
        .select("id, document_type, mime_type, file_size_bytes, verified_at, created_at")
        .eq("tenant_id", tenantId)
        .eq("resident_id", resident.id)
        .order("created_at", { ascending: false }),
    ])

    if (privateRes.data) {
      privateData = mapPrivateData(privateRes.data as RawPrivateDataRow)
    }

    documents = ((docsRes.data ?? []) as RawDocumentRow[]).map((doc) => ({
      id: doc.id,
      documentType: doc.document_type,
      mimeType: doc.mime_type,
      fileSizeBytes: doc.file_size_bytes,
      verifiedAt: doc.verified_at,
      createdAt: doc.created_at,
    }))
  }

  return {
    linked: true,
    resident,
    privateData,
    documents,
    household: householdRes.data
      ? mapHousehold(householdRes.data as RawHouseholdRow)
      : null,
    householdMembers: ((membersRes.data ?? []) as RawResidentRow[]).map(
      mapResident
    ),
    vehicles: ((vehiclesRes.data ?? []) as RawVehicleRow[]).map((v) => ({
      id: v.id,
      householdId: v.household_id,
      residentId: v.resident_id,
      vehicleType: v.vehicle_type,
      plateNumber: v.plate_number,
      brandModel: v.brand_model,
      color: v.color,
    })),
  }
}

