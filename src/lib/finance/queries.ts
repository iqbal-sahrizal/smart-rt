import "server-only"

import type {
  AdminFinanceDashboardSummary,
  BillPaymentSummary,
  BillStatus,
  BillSummary,
  CashCategorySummary,
  CashLedgerSummary,
  CashTransactionSummary,
  CashTransactionType,
  DuesBillingCycle,
  DuesSummary,
  DuesTargetHouseholdOption,
  DuesTargetResidentOption,
  DuesTargetScope,
  PaymentAuditEntry,
  PaymentDetailData,
  PaymentMethod,
  PaymentQueueItem,
  PaymentStatus,
  PaymentType,
  ResidentFinanceDashboardSummary,
} from "@/lib/finance/types"
import {
  getJakartaTodayIsoDate,
  isIncompletePaymentStale,
} from "@/lib/finance/types"
import { findUploadedPaymentProofPath } from "@/lib/finance/storage"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

interface RawDuesRow {
  id: string
  tenant_id: string
  name: string
  description: string | null
  amount: number | string
  billing_cycle: DuesBillingCycle
  target_scope: DuesTargetScope
  is_active: boolean
  created_at: string
  updated_at: string
}

interface RawBillRow {
  id: string
  tenant_id: string
  due_id: string
  household_id: string | null
  resident_id: string | null
  period_year: number
  period_month: number
  amount: number | string
  paid_amount: number | string
  due_date: string
  status: BillStatus
  paid_at: string | null
  created_at: string
  updated_at: string
}

function toNumeric(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function sanitizeSearchTerm(input: string | undefined): string {
  if (!input) return ""
  return input
    .trim()
    .replace(/[,()%*\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
}

function mapDuesRow(row: RawDuesRow, billCount?: number): DuesSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    amount: toNumeric(row.amount),
    billingCycle: row.billing_cycle,
    targetScope: row.target_scope,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(billCount !== undefined ? { billCount } : {}),
  }
}

const VALID_CYCLES = new Set<DuesBillingCycle>(["monthly", "yearly", "one_time"])
const VALID_SCOPES = new Set<DuesTargetScope>(["household", "resident"])
const VALID_BILL_STATUSES = new Set<BillStatus>([
  "unpaid",
  "partial",
  "pending_verification",
  "paid",
  "overdue",
  "cancelled",
  "refunded",
])

export interface DuesDirectoryResult {
  items: DuesSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  error: string | null
}

export async function getDuesDirectory({
  tenantId,
  search,
  billingCycle,
  targetScope,
  activeFilter,
  page = 1,
  pageSize = 10,
}: {
  tenantId: string
  search?: string
  billingCycle?: string
  targetScope?: string
  activeFilter?: string
  page?: number
  pageSize?: number
}): Promise<DuesDirectoryResult> {
  const supabase = await createClient()
  const cleanSearch = sanitizeSearchTerm(search)
  const validCycle =
    billingCycle && VALID_CYCLES.has(billingCycle as DuesBillingCycle)
      ? (billingCycle as DuesBillingCycle)
      : null
  const validScope =
    targetScope && VALID_SCOPES.has(targetScope as DuesTargetScope)
      ? (targetScope as DuesTargetScope)
      : null
  const activeBool =
    activeFilter === "active"
      ? true
      : activeFilter === "inactive"
        ? false
        : null

  const safePageSize = Math.min(Math.max(pageSize, 1), 50)
  const requestedPage =
    Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1

  let query = supabase
    .from("dues")
    .select(
      "id, tenant_id, name, description, amount, billing_cycle, target_scope, is_active, created_at, updated_at",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)

  if (validCycle) query = query.eq("billing_cycle", validCycle)
  if (validScope) query = query.eq("target_scope", validScope)
  if (activeBool !== null) query = query.eq("is_active", activeBool)
  if (cleanSearch) {
    query = query.or(
      `name.ilike.%${cleanSearch}%,description.ilike.%${cleanSearch}%`
    )
  }

  const from = (requestedPage - 1) * safePageSize
  const to = from + safePageSize - 1

  const { data, count, error } = await query
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(from, to)

  if (error) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      error: "Gagal memuat daftar konfigurasi iuran.",
    }
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const currentPage = Math.min(requestedPage, totalPages)

  let rows = (data ?? []) as RawDuesRow[]
  if (requestedPage > totalPages && totalCount > 0) {
    const correctedFrom = (currentPage - 1) * safePageSize
    const correctedTo = correctedFrom + safePageSize - 1
    let retryQuery = supabase
      .from("dues")
      .select(
        "id, tenant_id, name, description, amount, billing_cycle, target_scope, is_active, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)

    if (validCycle) retryQuery = retryQuery.eq("billing_cycle", validCycle)
    if (validScope) retryQuery = retryQuery.eq("target_scope", validScope)
    if (activeBool !== null) retryQuery = retryQuery.eq("is_active", activeBool)
    if (cleanSearch) {
      retryQuery = retryQuery.or(
        `name.ilike.%${cleanSearch}%,description.ilike.%${cleanSearch}%`
      )
    }

    const retryRes = await retryQuery
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(correctedFrom, correctedTo)

    rows = (retryRes.data ?? []) as RawDuesRow[]
  }

  return {
    items: rows.map((row) => mapDuesRow(row)),
    totalCount,
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    error: null,
  }
}

export async function getDuesDetail({
  tenantId,
  dueId,
}: {
  tenantId: string
  dueId: string
}): Promise<DuesSummary | null> {
  if (!isValidUuid(dueId)) return null

  const supabase = await createClient()
  const [{ data: row, error }, { count: billCount }] = await Promise.all([
    supabase
      .from("dues")
      .select(
        "id, tenant_id, name, description, amount, billing_cycle, target_scope, is_active, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .eq("id", dueId)
      .maybeSingle(),
    supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("due_id", dueId),
  ])

  if (error || !row) return null
  return mapDuesRow(row as RawDuesRow, billCount ?? 0)
}

async function hydrateBillRows({
  supabase,
  tenantId,
  rows,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  tenantId: string
  rows: RawBillRow[]
}): Promise<BillSummary[]> {
  if (rows.length === 0) return []

  const dueIds = Array.from(new Set(rows.map((r) => r.due_id)))
  const householdIds = Array.from(
    new Set(
      rows
        .map((r) => r.household_id)
        .filter((id): id is string => Boolean(id))
    )
  )
  const residentIds = Array.from(
    new Set(
      rows.map((r) => r.resident_id).filter((id): id is string => Boolean(id))
    )
  )

  const [duesRes, householdsRes, residentsRes] = await Promise.all([
    dueIds.length > 0
      ? supabase
          .from("dues")
          .select("id, name, billing_cycle, target_scope")
          .eq("tenant_id", tenantId)
          .in("id", dueIds)
      : Promise.resolve({ data: [] }),
    householdIds.length > 0
      ? supabase
          .from("households")
          .select("id, block_unit, address")
          .eq("tenant_id", tenantId)
          .in("id", householdIds)
      : Promise.resolve({ data: [] }),
    residentIds.length > 0
      ? supabase
          .from("residents")
          .select("id, full_name, household_id")
          .eq("tenant_id", tenantId)
          .in("id", residentIds)
      : Promise.resolve({ data: [] }),
  ])

  const dueMap = new Map(
    (
      (duesRes.data ?? []) as Array<{
        id: string
        name: string
        billing_cycle: DuesBillingCycle
        target_scope: DuesTargetScope
      }>
    ).map((d) => [d.id, d])
  )

  const householdMap = new Map(
    (
      (householdsRes.data ?? []) as Array<{
        id: string
        block_unit: string | null
        address: string
      }>
    ).map((h) => [
      h.id,
      h.block_unit ? `${h.block_unit} — ${h.address}` : h.address,
    ])
  )

  const residentMap = new Map(
    (
      (residentsRes.data ?? []) as Array<{
        id: string
        full_name: string
      }>
    ).map((r) => [r.id, r.full_name])
  )

  return rows.map((row) => {
    const due = dueMap.get(row.due_id)
    const amount = toNumeric(row.amount)
    const paidAmount = toNumeric(row.paid_amount)
    const remainingAmount = Math.max(0, amount - paidAmount)

    const targetLabel = row.household_id
      ? householdMap.get(row.household_id) ?? "Kartu Keluarga"
      : row.resident_id
        ? residentMap.get(row.resident_id) ?? "Warga"
        : "—"

    return {
      id: row.id,
      tenantId: row.tenant_id,
      dueId: row.due_id,
      dueName: due?.name ?? "Iuran RT",
      dueBillingCycle: due?.billing_cycle ?? "monthly",
      dueTargetScope: due?.target_scope ?? (row.household_id ? "household" : "resident"),
      householdId: row.household_id,
      residentId: row.resident_id,
      targetLabel,
      periodYear: row.period_year,
      periodMonth: row.period_month,
      amount,
      paidAmount,
      remainingAmount,
      dueDate: row.due_date,
      status: row.status,
      paidAt: row.paid_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })
}

export interface BillsDirectoryResult {
  items: BillSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  dueOptions: Array<{ id: string; name: string }>
  error: string | null
}

export async function getBillsDirectory({
  tenantId,
  search,
  status,
  dueId,
  periodYear,
  periodMonth,
  page = 1,
  pageSize = 10,
}: {
  tenantId: string
  search?: string
  status?: string
  dueId?: string
  periodYear?: number | null
  periodMonth?: number | null
  page?: number
  pageSize?: number
}): Promise<BillsDirectoryResult> {
  const supabase = await createClient()
  const cleanSearch = sanitizeSearchTerm(search)
  const validStatus =
    status && VALID_BILL_STATUSES.has(status as BillStatus)
      ? (status as BillStatus)
      : null
  const validDueId = dueId && isValidUuid(dueId) ? dueId : null
  const validYear =
    periodYear && periodYear >= 2000 && periodYear <= 2100 ? periodYear : null
  const validMonth =
    periodMonth && periodMonth >= 1 && periodMonth <= 12 ? periodMonth : null

  const safePageSize = Math.min(Math.max(pageSize, 1), 50)
  const requestedPage =
    Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1

  const { data: duesList } = await supabase
    .from("dues")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true })

  const dueOptions = (duesList ?? []) as Array<{ id: string; name: string }>

  // Resolve matching target/due IDs when search text is present
  let searchOrClause: string | null = null
  if (cleanSearch) {
    const [matchedDuesRes, matchedHhRes, matchedResRes] = await Promise.all([
      supabase
        .from("dues")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("name", `%${cleanSearch}%`),
      supabase
        .from("households")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(`block_unit.ilike.%${cleanSearch}%,address.ilike.%${cleanSearch}%`),
      supabase
        .from("residents")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .ilike("full_name", `%${cleanSearch}%`),
    ])

    const parts: string[] = []
    const mDueIds = ((matchedDuesRes.data ?? []) as Array<{ id: string }>).map(
      (d) => d.id
    )
    const mHhIds = ((matchedHhRes.data ?? []) as Array<{ id: string }>).map(
      (h) => h.id
    )
    const mResIds = ((matchedResRes.data ?? []) as Array<{ id: string }>).map(
      (r) => r.id
    )

    if (mDueIds.length > 0) parts.push(`due_id.in.(${mDueIds.join(",")})`)
    if (mHhIds.length > 0) parts.push(`household_id.in.(${mHhIds.join(",")})`)
    if (mResIds.length > 0) parts.push(`resident_id.in.(${mResIds.join(",")})`)

    if (parts.length === 0) {
      return {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: safePageSize,
        totalPages: 1,
        dueOptions,
        error: null,
      }
    }

    searchOrClause = parts.join(",")
  }

  const fetchBillsPage = async (rangeFrom: number, rangeTo: number) => {
    let q = supabase
      .from("bills")
      .select(
        "id, tenant_id, due_id, household_id, resident_id, period_year, period_month, amount, paid_amount, due_date, status, paid_at, created_at, updated_at",
        { count: "exact" }
      )
      .eq("tenant_id", tenantId)

    if (validStatus) q = q.eq("status", validStatus)
    if (validDueId) q = q.eq("due_id", validDueId)
    if (validYear) q = q.eq("period_year", validYear)
    if (validMonth) q = q.eq("period_month", validMonth)
    if (searchOrClause) q = q.or(searchOrClause)

    return q
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .order("due_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(rangeFrom, rangeTo)
  }

  const from = (requestedPage - 1) * safePageSize
  const to = from + safePageSize - 1

  const { data, count, error } = await fetchBillsPage(from, to)

  if (error) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      dueOptions,
      error: "Gagal memuat daftar tagihan warga.",
    }
  }

  const totalCount = count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const currentPage = Math.min(requestedPage, totalPages)

  let rows = (data ?? []) as RawBillRow[]
  if (requestedPage > totalPages && totalCount > 0) {
    const correctedFrom = (currentPage - 1) * safePageSize
    const correctedTo = correctedFrom + safePageSize - 1
    const retryRes = await fetchBillsPage(correctedFrom, correctedTo)
    rows = (retryRes.data ?? []) as RawBillRow[]
  }

  const items = await hydrateBillRows({ supabase, tenantId, rows })

  return {
    items,
    totalCount,
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
    dueOptions,
    error: null,
  }
}

export async function getBillFormOptions(tenantId: string): Promise<{
  dues: DuesSummary[]
  households: DuesTargetHouseholdOption[]
  residents: DuesTargetResidentOption[]
  existingBillKeys: string[]
}> {
  const supabase = await createClient()

  const [duesRes, householdsRes, residentsRes, existingBillsRes] =
    await Promise.all([
      supabase
        .from("dues")
        .select(
          "id, tenant_id, name, description, amount, billing_cycle, target_scope, is_active, created_at, updated_at"
        )
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("households")
        .select("id, block_unit, address")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("block_unit", { ascending: true, nullsFirst: false })
        .order("address", { ascending: true }),
      supabase
        .from("residents")
        .select("id, full_name, household_id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("residency_status", "aktif")
        .order("full_name", { ascending: true }),
      supabase
        .from("bills")
        .select("due_id, household_id, resident_id, period_year, period_month, status")
        .eq("tenant_id", tenantId)
        .neq("status", "cancelled"),
    ])

  const householdsList = (householdsRes.data ?? []) as Array<{
    id: string
    block_unit: string | null
    address: string
  }>

  const householdLabelMap = new Map(
    householdsList.map((h) => [
      h.id,
      h.block_unit ? `${h.block_unit} — ${h.address}` : h.address,
    ])
  )

  const households: DuesTargetHouseholdOption[] = householdsList.map((h) => ({
    id: h.id,
    label: h.block_unit ? `${h.block_unit} — ${h.address}` : h.address,
  }))

  const residents: DuesTargetResidentOption[] = (
    (residentsRes.data ?? []) as Array<{
      id: string
      full_name: string
      household_id: string
    }>
  ).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    householdLabel: householdLabelMap.get(r.household_id) ?? null,
  }))

  const existingBillKeys = (
    (existingBillsRes.data ?? []) as Array<{
      due_id: string
      household_id: string | null
      resident_id: string | null
      period_year: number
      period_month: number
    }>
  ).map((b) => {
    const targetId = b.household_id ?? b.resident_id ?? ""
    return `${b.due_id}|${targetId}|${b.period_year}|${b.period_month}`
  })

  return {
    dues: ((duesRes.data ?? []) as RawDuesRow[]).map((row) => mapDuesRow(row)),
    households,
    residents,
    existingBillKeys,
  }
}

export interface AdminBillDetailResult {
  bill: BillSummary
  payments: BillPaymentSummary[]
}

interface RawPaymentRow {
  id: string
  tenant_id: string
  bill_id: string
  payment_type: PaymentType
  parent_payment_id?: string | null
  amount: number | string
  payment_method: PaymentMethod
  status: PaymentStatus
  proof_storage_path: string | null
  paid_at: string
  verified_at: string | null
  notes: string | null
  created_at?: string
}

interface RejectionInfo {
  reason: string | null
  rejectedAt: string | null
}

function mapBillPayments(
  rows: RawPaymentRow[],
  rejectionMap?: Map<string, RejectionInfo>
): BillPaymentSummary[] {
  return rows.map((p) => {
    const rejection = rejectionMap?.get(p.id)
    return {
      id: p.id,
      paymentType: p.payment_type,
      parentPaymentId: p.parent_payment_id ?? null,
      amount: toNumeric(p.amount),
      paymentMethod: p.payment_method,
      status: p.status,
      proofStoragePath: p.proof_storage_path,
      paidAt: p.paid_at,
      verifiedAt: p.verified_at,
      createdAt: p.created_at ?? p.paid_at,
      notes: p.notes,
      rejectionReason: rejection?.reason ?? null,
      rejectedAt: rejection?.rejectedAt ?? null,
    }
  })
}

export async function getBillDetail({
  tenantId,
  billId,
}: {
  tenantId: string
  billId: string
}): Promise<AdminBillDetailResult | null> {
  if (!isValidUuid(billId)) return null

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("bills")
    .select(
      "id, tenant_id, due_id, household_id, resident_id, period_year, period_month, amount, paid_amount, due_date, status, paid_at, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", billId)
    .maybeSingle()

  if (error || !row) return null

  const [hydratedList, paymentsRes] = await Promise.all([
    hydrateBillRows({ supabase, tenantId, rows: [row as RawBillRow] }),
    supabase
      .from("payments")
      .select(
        "id, tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status, proof_storage_path, paid_at, verified_at, notes, created_at"
      )
      .eq("tenant_id", tenantId)
      .eq("bill_id", billId)
      .order("paid_at", { ascending: false }),
  ])

  const bill = hydratedList[0]
  if (!bill) return null

  const paymentRows = (paymentsRes.data ?? []) as RawPaymentRow[]
  const rejectedIds = paymentRows
    .filter((p) => p.status === "rejected")
    .map((p) => p.id)

  const rejectionMap = new Map<string, RejectionInfo>()
  if (rejectedIds.length > 0) {
    const { data: auditRows } = await supabase
      .from("audit_logs")
      .select("entity_id, metadata, created_at")
      .eq("tenant_id", tenantId)
      .eq("entity_type", "payments")
      .eq("action", "payment.rejected")
      .in("entity_id", rejectedIds)
      .order("created_at", { ascending: false })

    for (const log of (auditRows ?? []) as Array<{
      entity_id: string | null
      metadata: { reason?: unknown } | null
      created_at: string
    }>) {
      if (!log.entity_id || rejectionMap.has(log.entity_id)) continue
      const reason =
        typeof log.metadata?.reason === "string" &&
        log.metadata.reason.trim().length > 0
          ? log.metadata.reason.trim()
          : null
      rejectionMap.set(log.entity_id, {
        reason,
        rejectedAt: log.created_at,
      })
    }
  }

  return { bill, payments: mapBillPayments(paymentRows, rejectionMap) }
}

export interface ResidentBillsPortalResult {
  items: BillSummary[]
  outstandingCount: number
  overdueCount: number
  totalOutstandingAmount: number
  error: string | null
}

const RESIDENT_ACTIVE_BILL_STATUSES = new Set<BillStatus>([
  "overdue",
  "unpaid",
  "partial",
  "pending_verification",
])

export async function getResidentBillsPortal(
  tenantId: string
): Promise<ResidentBillsPortalResult> {
  const supabase = await createClient()
  const todayIso = getJakartaTodayIsoDate()

  // RLS bills_select restricts automatically to bills targeting caller's household_id or resident_id.
  const { data, error } = await supabase
    .from("bills")
    .select(
      "id, tenant_id, due_id, household_id, resident_id, period_year, period_month, amount, paid_amount, due_date, status, paid_at, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: false })

  if (error) {
    return {
      items: [],
      outstandingCount: 0,
      overdueCount: 0,
      totalOutstandingAmount: 0,
      error: "Gagal memuat daftar tagihan Anda.",
    }
  }

  const hydrated = await hydrateBillRows({
    supabase,
    tenantId,
    rows: (data ?? []) as RawBillRow[],
  })

  // Sort active obligations first (earliest due date first), then historical/settled bills (newest first)
  const items = [...hydrated].sort((a, b) => {
    const aActive = RESIDENT_ACTIVE_BILL_STATUSES.has(a.status)
    const bActive = RESIDENT_ACTIVE_BILL_STATUSES.has(b.status)
    if (aActive !== bActive) return aActive ? -1 : 1
    if (aActive && bActive) {
      return a.dueDate.localeCompare(b.dueDate)
    }
    return b.dueDate.localeCompare(a.dueDate)
  })

  let outstandingCount = 0
  let overdueCount = 0
  let totalOutstandingAmount = 0

  for (const bill of items) {
    if (RESIDENT_ACTIVE_BILL_STATUSES.has(bill.status)) {
      outstandingCount += 1
      totalOutstandingAmount += bill.remainingAmount
      if (bill.status === "overdue" || bill.dueDate < todayIso) {
        overdueCount += 1
      }
    }
  }

  return {
    items,
    outstandingCount,
    overdueCount,
    totalOutstandingAmount,
    error: null,
  }
}

export async function getResidentBillDetail({
  tenantId,
  billId,
}: {
  tenantId: string
  billId: string
}): Promise<{ bill: BillSummary; payments: BillPaymentSummary[] } | null> {
  if (!isValidUuid(billId)) return null

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("bills")
    .select(
      "id, tenant_id, due_id, household_id, resident_id, period_year, period_month, amount, paid_amount, due_date, status, paid_at, created_at, updated_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", billId)
    .maybeSingle()

  if (error || !row) return null

  const [hydrated, paymentsRes, rejectionRpcRes] = await Promise.all([
    hydrateBillRows({ supabase, tenantId, rows: [row as RawBillRow] }),
    supabase
      .from("payments")
      .select(
        "id, tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status, proof_storage_path, paid_at, verified_at, notes, created_at"
      )
      .eq("tenant_id", tenantId)
      .eq("bill_id", billId)
      .order("paid_at", { ascending: false }),
    supabase.rpc("get_my_payment_rejection_reasons", { p_bill_id: billId }),
  ])

  const bill = hydrated[0]
  if (!bill) return null

  const rejectionMap = new Map<string, RejectionInfo>()
  if (!rejectionRpcRes.error && Array.isArray(rejectionRpcRes.data)) {
    for (const entry of rejectionRpcRes.data as Array<{
      payment_id: string
      reason: string | null
      rejected_at: string | null
    }>) {
      rejectionMap.set(entry.payment_id, {
        reason: entry.reason,
        rejectedAt: entry.rejected_at,
      })
    }
  }

  const mappedPayments = mapBillPayments(
    (paymentsRes.data ?? []) as RawPaymentRow[],
    rejectionMap
  )
  const nowMs = Date.now()
  const enrichedPayments = await Promise.all(
    mappedPayments.map(async (p) => {
      if (
        p.paymentType === "payment" &&
        p.status === "pending" &&
        p.proofStoragePath === null
      ) {
        const isStaleIncomplete = isIncompletePaymentStale(
          p.createdAt ?? p.paidAt,
          nowMs
        )
        const existingPath = isStaleIncomplete
          ? null
          : await findUploadedPaymentProofPath({
              supabase,
              tenantId,
              paymentId: p.id,
            })
        return {
          ...p,
          isStaleIncomplete,
          hasUploadedProofInStorage: existingPath !== null,
        }
      }
      return p
    })
  )

  return {
    bill,
    payments: enrichedPayments,
  }
}

export async function getAdminFinanceSummary(
  tenantId: string
): Promise<AdminFinanceDashboardSummary> {
  const supabase = await createClient()
  const todayIso = getJakartaTodayIsoDate()

  const [{ count: activeDuesCount }, { data: outstandingRows }] =
    await Promise.all([
      supabase
        .from("dues")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      supabase
        .from("bills")
        .select(
          "id, tenant_id, due_id, household_id, resident_id, period_year, period_month, amount, paid_amount, due_date, status, paid_at, created_at, updated_at"
        )
        .eq("tenant_id", tenantId)
        .in("status", ["unpaid", "partial", "overdue", "pending_verification"])
        .order("due_date", { ascending: true }),
    ])

  const rawRows = (outstandingRows ?? []) as RawBillRow[]
  let overdueBillCount = 0
  let pendingVerificationCount = 0
  let totalOutstandingAmount = 0

  for (const row of rawRows) {
    const amount = toNumeric(row.amount)
    const paidAmount = toNumeric(row.paid_amount)
    totalOutstandingAmount += Math.max(0, amount - paidAmount)
    if (row.status === "pending_verification") {
      pendingVerificationCount += 1
    }
    if (row.status === "overdue" || row.due_date < todayIso) {
      overdueBillCount += 1
    }
  }

  const recentBills = await hydrateBillRows({
    supabase,
    tenantId,
    rows: rawRows.slice(0, 4),
  })

  return {
    activeDuesCount: activeDuesCount ?? 0,
    outstandingBillCount: rawRows.length,
    overdueBillCount,
    pendingVerificationCount,
    totalOutstandingAmount,
    recentBills,
  }
}

export async function getResidentFinanceSummary(
  tenantId: string
): Promise<ResidentFinanceDashboardSummary> {
  const portal = await getResidentBillsPortal(tenantId)
  const upcomingBills = portal.items
    .filter((b) => RESIDENT_ACTIVE_BILL_STATUSES.has(b.status))
    .slice(0, 3)
  const pendingVerificationCount = portal.items.filter(
    (b) => b.status === "pending_verification"
  ).length

  return {
    outstandingCount: portal.outstandingCount,
    overdueCount: portal.overdueCount,
    pendingVerificationCount,
    totalOutstandingAmount: portal.totalOutstandingAmount,
    upcomingBills,
  }
}

const VALID_PAYMENT_STATUSES = new Set<PaymentStatus>([
  "pending",
  "verified",
  "failed",
  "rejected",
  "refunded",
])

const VALID_PAYMENT_METHODS = new Set<PaymentMethod>([
  "transfer",
  "qris",
  "cash",
  "gateway",
])

export interface PaymentVerificationQueueResult {
  items: PaymentQueueItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  counts: {
    pending: number
    verified: number
    rejected: number
    all: number
  }
  incomeCategories: CashCategorySummary[]
  recentIncomeTransactions: CashTransactionSummary[]
  error: string | null
}

async function fetchTenantCashCategories(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string
): Promise<CashCategorySummary[]> {
  const { data } = await supabase
    .from("cash_categories")
    .select("id, tenant_id, name, type, is_active")
    .eq("tenant_id", tenantId)
    .order("type", { ascending: true })
    .order("name", { ascending: true })

  return (
    (data ?? []) as Array<{
      id: string
      tenant_id: string
      name: string
      type: "income" | "expense"
      is_active: boolean
    }>
  ).map((c) => ({
    id: c.id,
    tenantId: c.tenant_id,
    name: c.name,
    type: c.type,
    isActive: c.is_active,
  }))
}

async function fetchIncomeCashCategories(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string
): Promise<CashCategorySummary[]> {
  const all = await fetchTenantCashCategories(supabase, tenantId)
  return all.filter((c) => c.type === "income" && c.isActive)
}

export async function getPaymentVerificationQueue({
  tenantId,
  status = "pending",
  method,
  search,
  page = 1,
  pageSize = 10,
}: {
  tenantId: string
  status?: string
  method?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<PaymentVerificationQueueResult> {
  const supabase = await createClient()
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const safePageSize =
    Number.isFinite(pageSize) && pageSize >= 1 && pageSize <= 50
      ? Math.floor(pageSize)
      : 10

  const [paymentsRes, incomeCategories, cashTxRes] = await Promise.all([
    supabase
      .from("payments")
      .select(
        "id, tenant_id, bill_id, payment_type, amount, payment_method, status, proof_storage_path, paid_at, verified_at, notes, created_at"
      )
      .eq("tenant_id", tenantId)
      .eq("payment_type", "payment")
      .order("created_at", { ascending: false }),
    fetchIncomeCashCategories(supabase, tenantId),
    supabase
      .from("cash_transactions")
      .select(
        "id, tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_at"
      )
      .eq("tenant_id", tenantId)
      .eq("type", "income")
      .order("created_at", { ascending: false })
      .limit(8),
  ])

  if (paymentsRes.error) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      counts: { pending: 0, verified: 0, rejected: 0, all: 0 },
      incomeCategories,
      recentIncomeTransactions: [],
      error: "Gagal memuat antrean verifikasi pembayaran.",
    }
  }

  // Exclude incomplete draft rows whose proof upload never completed from active review queue
  const rawPayments = ((paymentsRes.data ?? []) as RawPaymentRow[]).filter(
    (p) => !(p.status === "pending" && p.proof_storage_path === null)
  )
  const billIds = Array.from(new Set(rawPayments.map((p) => p.bill_id)))

  const billMap = new Map<string, BillSummary>()
  if (billIds.length > 0) {
    const { data: billRows } = await supabase
      .from("bills")
      .select(
        "id, tenant_id, due_id, household_id, resident_id, period_year, period_month, amount, paid_amount, due_date, status, paid_at, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .in("id", billIds)

    const hydratedBills = await hydrateBillRows({
      supabase,
      tenantId,
      rows: (billRows ?? []) as RawBillRow[],
    })
    for (const bill of hydratedBills) {
      billMap.set(bill.id, bill)
    }
  }

  const allItems: PaymentQueueItem[] = rawPayments.map((p) => {
    const bill = billMap.get(p.bill_id)
    return {
      id: p.id,
      tenantId: p.tenant_id,
      billId: p.bill_id,
      dueName: bill?.dueName ?? "Tagihan Iuran",
      targetLabel: bill?.targetLabel ?? "—",
      periodYear: bill?.periodYear ?? 0,
      periodMonth: bill?.periodMonth ?? 0,
      billAmount: bill?.amount ?? toNumeric(p.amount),
      billPaidAmount: bill?.paidAmount ?? 0,
      billStatus: bill?.status ?? "unpaid",
      paymentType: p.payment_type,
      amount: toNumeric(p.amount),
      paymentMethod: p.payment_method,
      status: p.status,
      proofStoragePath: p.proof_storage_path,
      notes: p.notes,
      paidAt: p.paid_at,
      verifiedAt: p.verified_at,
      createdAt: p.created_at ?? p.paid_at,
    }
  })

  const counts = {
    pending: allItems.filter((item) => item.status === "pending").length,
    verified: allItems.filter((item) => item.status === "verified").length,
    rejected: allItems.filter((item) => item.status === "rejected").length,
    all: allItems.length,
  }

  const cleanSearch = sanitizeSearchTerm(search).toLowerCase()
  const filtered = allItems.filter((item) => {
    if (status !== "all" && VALID_PAYMENT_STATUSES.has(status as PaymentStatus)) {
      if (item.status !== status) return false
    }
    if (
      method &&
      method !== "all" &&
      VALID_PAYMENT_METHODS.has(method as PaymentMethod)
    ) {
      if (item.paymentMethod !== method) return false
    }
    if (cleanSearch) {
      const hay =
        `${item.dueName} ${item.targetLabel} ${item.id} ${item.billId}`.toLowerCase()
      if (!hay.includes(cleanSearch)) return false
    }
    return true
  })

  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const clampedPage = Math.min(safePage, totalPages)
  const from = (clampedPage - 1) * safePageSize

  const categoryNameMap = new Map(
    incomeCategories.map((c) => [c.id, c.name])
  )
  const recentIncomeTransactions: CashTransactionSummary[] = (
    (cashTxRes.data ?? []) as Array<{
      id: string
      tenant_id: string
      category_id: string
      payment_id: string | null
      type: "income" | "expense"
      amount: number | string
      transaction_date: string
      description: string | null
      created_at: string
    }>
  ).map((tx) => ({
    id: tx.id,
    tenantId: tx.tenant_id,
    categoryId: tx.category_id,
    categoryName: categoryNameMap.get(tx.category_id) ?? "Kas Masuk",
    paymentId: tx.payment_id,
    type: tx.type,
    amount: toNumeric(tx.amount),
    transactionDate: tx.transaction_date,
    description: tx.description,
    createdAt: tx.created_at,
  }))

  return {
    items: filtered.slice(from, from + safePageSize),
    totalCount,
    page: clampedPage,
    pageSize: safePageSize,
    totalPages,
    counts,
    incomeCategories,
    recentIncomeTransactions,
    error: null,
  }
}

export async function getPaymentDetail({
  tenantId,
  paymentId,
}: {
  tenantId: string
  paymentId: string
}): Promise<PaymentDetailData | null> {
  if (!isValidUuid(paymentId)) return null

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from("payments")
    .select(
      "id, tenant_id, bill_id, payment_type, amount, payment_method, status, proof_storage_path, paid_at, verified_at, notes, created_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", paymentId)
    .maybeSingle()

  if (error || !row) return null

  const rawPayment = row as RawPaymentRow
  const [billDetail, allCategories, cashTxRes, refundsRes] =
    await Promise.all([
      getBillDetail({ tenantId, billId: rawPayment.bill_id }),
      fetchTenantCashCategories(supabase, tenantId),
      supabase
        .from("cash_transactions")
        .select(
          "id, tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_at, updated_at"
        )
        .eq("tenant_id", tenantId)
        .eq("payment_id", paymentId)
        .maybeSingle(),
      supabase
        .from("payments")
        .select(
          "id, tenant_id, bill_id, payment_type, parent_payment_id, amount, payment_method, status, proof_storage_path, paid_at, verified_at, notes, created_at"
        )
        .eq("tenant_id", tenantId)
        .eq("parent_payment_id", paymentId)
        .eq("payment_type", "refund")
        .order("created_at", { ascending: false }),
    ])

  if (!billDetail) return null

  const refundIds = ((refundsRes.data ?? []) as RawPaymentRow[]).map((r) => r.id)
  const auditEntityIds = [paymentId, ...refundIds]
  const auditRes = await supabase
    .from("audit_logs")
    .select("id, action, metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_type", "payments")
    .in("entity_id", auditEntityIds)
    .order("created_at", { ascending: false })

  const incomeCategories = allCategories.filter(
    (c) => c.type === "income" && c.isActive
  )
  const expenseCategories = allCategories.filter(
    (c) => c.type === "expense" && c.isActive
  )
  const categoryNameMap = new Map(allCategories.map((c) => [c.id, c.name]))

  const { bill, payments: billPayments } = billDetail
  const payment: PaymentQueueItem = {
    id: rawPayment.id,
    tenantId: rawPayment.tenant_id,
    billId: rawPayment.bill_id,
    dueName: bill.dueName,
    targetLabel: bill.targetLabel,
    periodYear: bill.periodYear,
    periodMonth: bill.periodMonth,
    billAmount: bill.amount,
    billPaidAmount: bill.paidAmount,
    billStatus: bill.status,
    paymentType: rawPayment.payment_type,
    amount: toNumeric(rawPayment.amount),
    paymentMethod: rawPayment.payment_method,
    status: rawPayment.status,
    proofStoragePath: rawPayment.proof_storage_path,
    notes: rawPayment.notes,
    paidAt: rawPayment.paid_at,
    verifiedAt: rawPayment.verified_at,
    createdAt: rawPayment.created_at ?? rawPayment.paid_at,
  }

  let linkedCashTransaction: CashTransactionSummary | null = null
  if (cashTxRes.data) {
    const tx = cashTxRes.data as {
      id: string
      tenant_id: string
      category_id: string
      payment_id: string | null
      type: "income" | "expense"
      amount: number | string
      transaction_date: string
      description: string | null
      created_at: string
      updated_at?: string | null
    }
    const categoryName =
      categoryNameMap.get(tx.category_id) ??
      (tx.type === "expense" ? "Pengeluaran Kas" : "Kas Masuk")
    linkedCashTransaction = {
      id: tx.id,
      tenantId: tx.tenant_id,
      categoryId: tx.category_id,
      categoryName,
      paymentId: tx.payment_id,
      type: tx.type,
      amount: toNumeric(tx.amount),
      transactionDate: tx.transaction_date,
      description: tx.description,
      createdAt: tx.created_at,
      updatedAt: tx.updated_at ?? null,
    }
  }

  const refunds = mapBillPayments((refundsRes.data ?? []) as RawPaymentRow[])
  const refundedAmount = refunds
    .filter((r) => r.status === "verified")
    .reduce((sum, r) => sum + r.amount, 0)
  const remainingRefundableAmount =
    payment.paymentType === "payment" &&
    (payment.status === "verified" || payment.status === "refunded")
      ? Math.max(0, Math.round((payment.amount - refundedAmount) * 100) / 100)
      : 0

  const auditEntries: PaymentAuditEntry[] = (
    (auditRes.data ?? []) as Array<{
      id: string
      action: string
      metadata: {
        reason?: unknown
        reviewer_notes?: unknown
        bill_status?: unknown
      } | null
      created_at: string
    }>
  ).map((log) => ({
    id: log.id,
    action: log.action,
    createdAt: log.created_at,
    reason:
      typeof log.metadata?.reason === "string" ? log.metadata.reason : null,
    reviewerNotes:
      typeof log.metadata?.reviewer_notes === "string"
        ? log.metadata.reviewer_notes
        : null,
    billStatus:
      typeof log.metadata?.bill_status === "string"
        ? log.metadata.bill_status
        : null,
  }))

  return {
    payment,
    bill,
    billPayments,
    incomeCategories,
    expenseCategories,
    linkedCashTransaction,
    refunds,
    refundedAmount,
    remainingRefundableAmount,
    auditEntries,
  }
}

export interface CashLedgerResult {
  items: CashTransactionSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  summary: CashLedgerSummary
  categories: CashCategorySummary[]
  error: string | null
}

const VALID_CASH_TYPES = new Set<CashTransactionType>(["income", "expense"])

export async function getCashLedger({
  tenantId,
  type = "all",
  categoryId = "all",
  startDate,
  endDate,
  search,
  page = 1,
  pageSize = 15,
}: {
  tenantId: string
  type?: string
  categoryId?: string
  startDate?: string
  endDate?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<CashLedgerResult> {
  const supabase = await createClient()
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const safePageSize =
    Number.isFinite(pageSize) && pageSize >= 1 && pageSize <= 50
      ? Math.floor(pageSize)
      : 15

  const [categories, txRes] = await Promise.all([
    fetchTenantCashCategories(supabase, tenantId),
    supabase
      .from("cash_transactions")
      .select(
        "id, tenant_id, category_id, payment_id, type, amount, transaction_date, description, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ])

  if (txRes.error) {
    return {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: safePageSize,
      totalPages: 1,
      summary: {
        totalIncome: 0,
        totalExpense: 0,
        netBalance: 0,
        filteredIncome: 0,
        filteredExpense: 0,
        filteredNet: 0,
      },
      categories,
      error: "Gagal memuat buku kas & pengeluaran RT.",
    }
  }

  const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]))
  const allTx: CashTransactionSummary[] = (
    (txRes.data ?? []) as Array<{
      id: string
      tenant_id: string
      category_id: string
      payment_id: string | null
      type: CashTransactionType
      amount: number | string
      transaction_date: string
      description: string | null
      created_at: string
      updated_at: string | null
    }>
  ).map((tx) => ({
    id: tx.id,
    tenantId: tx.tenant_id,
    categoryId: tx.category_id,
    categoryName:
      categoryNameMap.get(tx.category_id) ??
      (tx.type === "expense" ? "Pengeluaran Kas" : "Kas Masuk"),
    paymentId: tx.payment_id,
    type: tx.type,
    amount: toNumeric(tx.amount),
    transactionDate: tx.transaction_date,
    description: tx.description,
    createdAt: tx.created_at,
    updatedAt: tx.updated_at,
  }))

  let totalIncome = 0
  let totalExpense = 0
  for (const tx of allTx) {
    if (tx.type === "income") {
      totalIncome += tx.amount
    } else {
      totalExpense += tx.amount
    }
  }

  const cleanStartDate =
    startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())
      ? startDate.trim()
      : null
  const cleanEndDate =
    endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())
      ? endDate.trim()
      : null
  const cleanSearch = sanitizeSearchTerm(search).toLowerCase()

  const filtered = allTx.filter((tx) => {
    if (type !== "all" && VALID_CASH_TYPES.has(type as CashTransactionType)) {
      if (tx.type !== type) return false
    }
    if (categoryId && categoryId !== "all" && isValidUuid(categoryId)) {
      if (tx.categoryId !== categoryId) return false
    }
    if (cleanStartDate && tx.transactionDate < cleanStartDate) {
      return false
    }
    if (cleanEndDate && tx.transactionDate > cleanEndDate) {
      return false
    }
    if (cleanSearch) {
      const hay = `${tx.categoryName} ${tx.description ?? ""} ${tx.id}`.toLowerCase()
      if (!hay.includes(cleanSearch)) return false
    }
    return true
  })

  let filteredIncome = 0
  let filteredExpense = 0
  for (const tx of filtered) {
    if (tx.type === "income") {
      filteredIncome += tx.amount
    } else {
      filteredExpense += tx.amount
    }
  }

  const totalCount = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const clampedPage = Math.min(safePage, totalPages)
  const from = (clampedPage - 1) * safePageSize

  return {
    items: filtered.slice(from, from + safePageSize),
    totalCount,
    page: clampedPage,
    pageSize: safePageSize,
    totalPages,
    summary: {
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
      netBalance: Math.round((totalIncome - totalExpense) * 100) / 100,
      filteredIncome: Math.round(filteredIncome * 100) / 100,
      filteredExpense: Math.round(filteredExpense * 100) / 100,
      filteredNet: Math.round((filteredIncome - filteredExpense) * 100) / 100,
    },
    categories,
    error: null,
  }
}
