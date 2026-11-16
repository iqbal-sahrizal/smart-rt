import "server-only"

import { getRecentAdminAnnouncements, getRecentResidentAnnouncements } from "@/lib/announcements/queries"
import { ANNOUNCEMENT_STATUS_LABELS } from "@/lib/announcements/types"
import { getAuthContext } from "@/lib/auth/server"
import type { ActiveTenantMembership, AuthContextData } from "@/lib/auth/types"
import {
  escapeCsvCell,
  formatIsoDateParts,
  getLastDayOfMonth,
} from "@/lib/analytics/schemas"
import {
  COMPLAINT_STATUS_LABELS,
  getComplaintStatusBadgeVariant,
  getLetterStatusBadgeVariant,
  LETTER_STATUS_LABELS,
  type ActivityStatus,
  type AdminActivityFeedItem,
  type AdminDashboardAnalyticsData,
  type AdminRecentComplaintItem,
  type AdminRecentLetterItem,
  type AdminRecentPaymentItem,
  type AnalyticsActivityCategory,
  type CashTrendBucket,
  type ComplaintPriority,
  type ComplaintStatus,
  type ComplaintTrendBucket,
  type LetterDistributionItem,
  type LetterRequestStatus,
  type PaymentTrendBucket,
  type ResidentDashboardData,
  type ResolvedAnalyticsPeriod,
} from "@/lib/analytics/types"
import { getResidentBillsPortal } from "@/lib/finance/queries"
import {
  formatBillPeriod,
  formatIdr,
  getJakartaTodayIsoDate,
  getPaymentStatusBadgeVariant,
  INDONESIAN_MONTH_NAMES,
  isBillEffectivelyOverdue,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type BillStatus,
  type BillSummary,
  type CashTransactionType,
  type DuesBillingCycle,
  type DuesTargetScope,
  type PaymentMethod,
  type PaymentStatus,
  type PaymentType,
} from "@/lib/finance/types"
import { getResidentPortalData } from "@/lib/residents/queries"
import { createClient } from "@/lib/supabase/server"

const SHORT_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const

const LETTER_STATUSES_ORDER: readonly LetterRequestStatus[] = [
  "submitted",
  "reviewing",
  "approved",
  "completed",
  "rejected",
  "cancelled",
]

function toNumeric(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function toJakartaIsoDate(value: string | null | undefined): string {
  if (!value) return ""
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ""
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed)
}

interface TimeBucketSpec {
  key: string
  label: string
  startDate: string
  endDate: string
}

function buildTimeBuckets(period: ResolvedAnalyticsPeriod): TimeBucketSpec[] {
  if (period.granularity === "week") {
    const buckets: TimeBucketSpec[] = []
    let cursorMs = Date.parse(`${period.startDate}T00:00:00Z`)
    const endMs = Date.parse(`${period.endDate}T00:00:00Z`)
    let idx = 0

    while (cursorMs <= endMs) {
      const bucketEndMs = Math.min(endMs, cursorMs + 6 * 86_400_000)
      const startIso = new Date(cursorMs).toISOString().slice(0, 10)
      const endIso = new Date(bucketEndMs).toISOString().slice(0, 10)
      const startDay = startIso.slice(8, 10)
      const endDay = endIso.slice(8, 10)
      const monthLabel =
        SHORT_MONTH_LABELS[Number(endIso.slice(5, 7)) - 1] ?? endIso.slice(5, 7)

      buckets.push({
        key: `w${idx}-${startIso}`,
        label:
          startIso === endIso
            ? `${startDay} ${monthLabel}`
            : `${startDay}–${endDay} ${monthLabel}`,
        startDate: startIso,
        endDate: endIso,
      })

      cursorMs = bucketEndMs + 86_400_000
      idx += 1
    }

    return buckets
  }

  // Monthly buckets spanning startDate..endDate
  const startYear = Number(period.startDate.slice(0, 4))
  const startMonth = Number(period.startDate.slice(5, 7))
  const endYear = Number(period.endDate.slice(0, 4))
  const endMonth = Number(period.endDate.slice(5, 7))
  const spansMultipleYears = startYear !== endYear

  const buckets: TimeBucketSpec[] = []
  let y = startYear
  let m = startMonth

  while (y < endYear || (y === endYear && m <= endMonth)) {
    const monthStart = formatIsoDateParts(y, m, 1)
    const monthEnd = formatIsoDateParts(y, m, getLastDayOfMonth(y, m))
    const clampedStart =
      monthStart < period.startDate ? period.startDate : monthStart
    const clampedEnd = monthEnd > period.endDate ? period.endDate : monthEnd

    const shortMonth = SHORT_MONTH_LABELS[m - 1] ?? String(m)
    const label = spansMultipleYears
      ? `${shortMonth} ${String(y).slice(-2)}`
      : shortMonth

    buckets.push({
      key: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`,
      label,
      startDate: clampedStart,
      endDate: clampedEnd,
    })

    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }

  return buckets
}

function findBucketIndex(
  buckets: TimeBucketSpec[],
  isoDate: string
): number {
  if (!isoDate) return -1
  for (let i = 0; i < buckets.length; i++) {
    if (isoDate >= buckets[i].startDate && isoDate <= buckets[i].endDate) {
      return i
    }
  }
  return -1
}

export async function resolveScopedAdminAnalyticsContext(): Promise<
  | {
      status: "ok"
      context: { ctx: AuthContextData; tenant: ActiveTenantMembership }
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
> {
  const ctx = await getAuthContext()
  if (!ctx) {
    return { status: "unauthenticated" }
  }

  const adminMemberships = ctx.memberships.filter((m) => m.hasAdminRole)
  if (adminMemberships.length === 0) {
    return { status: "forbidden" }
  }

  if (ctx.workspaceOptions.length > 1) {
    if (!ctx.selectedWorkspace || ctx.selectedWorkspace.type !== "admin") {
      return { status: "forbidden" }
    }
    const matched = adminMemberships.find(
      (m) => m.tenantId === ctx.selectedWorkspace?.tenantId
    )
    if (!matched) {
      return { status: "forbidden" }
    }
    return { status: "ok", context: { ctx, tenant: matched } }
  }

  return { status: "ok", context: { ctx, tenant: adminMemberships[0] } }
}

export async function getAdminDashboardAnalytics({
  tenantId,
  tenantName,
  tenantSubtitle,
  filter,
  activityCategory = "all",
  activityPage = 1,
  activityPageSize = 6,
}: {
  tenantId: string
  tenantName: string
  tenantSubtitle: string
  filter: ResolvedAnalyticsPeriod
  activityCategory?: AnalyticsActivityCategory
  activityPage?: number
  activityPageSize?: number
}): Promise<AdminDashboardAnalyticsData> {
  const supabase = await createClient()
  const todayIso = getJakartaTodayIsoDate()

  const [
    householdsRes,
    residentsRes,
    duesRes,
    billsRes,
    paymentsRes,
    cashTxRes,
    complaintsRes,
    lettersRes,
    letterTypesRes,
    membersRes,
    recentAnnouncements,
  ] = await Promise.all([
    supabase
      .from("households")
      .select("id, kk_number, address, block_unit, head_resident_id, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null),
    supabase
      .from("residents")
      .select("id, household_id, full_name, residency_status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null),
    supabase
      .from("dues")
      .select("id, name, billing_cycle, target_scope, is_active")
      .eq("tenant_id", tenantId),
    supabase
      .from("bills")
      .select(
        "id, tenant_id, due_id, household_id, resident_id, period_year, period_month, amount, paid_amount, due_date, status, paid_at, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .order("due_date", { ascending: true }),
    supabase
      .from("payments")
      .select(
        "id, bill_id, payment_type, amount, payment_method, proof_storage_path, status, paid_at, verified_at, created_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("cash_transactions")
      .select(
        "id, category_id, payment_id, type, amount, transaction_date, description, created_at"
      )
      .eq("tenant_id", tenantId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("complaints")
      .select(
        "id, reporter_member_id, category, title, priority, status, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("letter_requests")
      .select(
        "id, letter_type_id, resident_id, requested_by_member_id, purpose, status, letter_number, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("letter_types")
      .select("id, name, code")
      .eq("tenant_id", tenantId),
    supabase
      .from("tenant_members")
      .select("id, resident_id")
      .eq("tenant_id", tenantId),
    getRecentAdminAnnouncements(tenantId, 6),
  ])

  const queryError =
    householdsRes.error ||
    residentsRes.error ||
    duesRes.error ||
    billsRes.error ||
    paymentsRes.error ||
    cashTxRes.error ||
    complaintsRes.error ||
    lettersRes.error ||
    letterTypesRes.error

  const buckets = buildTimeBuckets(filter)

  if (queryError) {
    return {
      tenantId,
      tenantName,
      tenantSubtitle,
      period: filter,
      kpis: {
        activeResidentsCount: 0,
        totalResidentsCount: 0,
        activeHouseholdsCount: 0,
        totalHouseholdsCount: 0,
        activeBillsCount: 0,
        overdueBillsCount: 0,
        totalOutstandingAmount: 0,
        activeDuesCount: 0,
        verifiedPaymentsNetAmount: 0,
        verifiedPaymentsCount: 0,
        pendingVerificationPaymentsCount: 0,
        cashBalance: 0,
        totalLedgerIncome: 0,
        totalLedgerExpense: 0,
        periodIncome: 0,
        periodExpense: 0,
        periodNet: 0,
        unfinishedComplaintsCount: 0,
        openComplaintsCount: 0,
        inProgressComplaintsCount: 0,
        pendingLettersCount: 0,
        submittedLettersCount: 0,
        reviewingLettersCount: 0,
      },
      cashTrend: buckets.map((b) => ({
        key: b.key,
        label: b.label,
        income: 0,
        expense: 0,
        net: 0,
      })),
      paymentTrend: buckets.map((b) => ({
        key: b.key,
        label: b.label,
        verifiedAmount: 0,
        refundedAmount: 0,
        netAmount: 0,
        verifiedCount: 0,
      })),
      complaintTrend: buckets.map((b) => ({
        key: b.key,
        label: b.label,
        open: 0,
        inProgress: 0,
        resolved: 0,
        rejected: 0,
        total: 0,
      })),
      letterDistribution: LETTER_STATUSES_ORDER.map((status) => ({
        status,
        label: LETTER_STATUS_LABELS[status],
        count: 0,
        percentage: 0,
      })),
      totalLettersInPeriod: 0,
      recentPayments: [],
      recentComplaints: [],
      recentLetters: [],
      recentBills: [],
      recentAnnouncements,
      activityFeed: {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: activityPageSize,
        totalPages: 1,
      },
      error: "Gagal memuat sebagian data analitik dashboard.",
    }
  }

  // Type assertions over strictly selected fields
  const households = (householdsRes.data ?? []) as Array<{
    id: string
    kk_number: string
    address: string
    block_unit: string | null
    head_resident_id: string | null
    status: "active" | "inactive"
  }>
  const residents = (residentsRes.data ?? []) as Array<{
    id: string
    household_id: string
    full_name: string
    residency_status: string
  }>
  const dues = (duesRes.data ?? []) as Array<{
    id: string
    name: string
    billing_cycle: DuesBillingCycle
    target_scope: DuesTargetScope
    is_active: boolean
  }>
  const bills = (billsRes.data ?? []) as Array<{
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
  }>
  const payments = (paymentsRes.data ?? []) as Array<{
    id: string
    bill_id: string
    payment_type: PaymentType
    amount: number | string
    payment_method: PaymentMethod
    proof_storage_path: string | null
    status: PaymentStatus
    paid_at: string
    verified_at: string | null
    created_at: string
  }>
  const cashTransactions = (cashTxRes.data ?? []) as Array<{
    id: string
    category_id: string
    payment_id: string | null
    type: CashTransactionType
    amount: number | string
    transaction_date: string
    description: string
    created_at: string
  }>
  const complaints = (complaintsRes.data ?? []) as Array<{
    id: string
    reporter_member_id: string
    category: string
    title: string
    priority: ComplaintPriority
    status: ComplaintStatus
    created_at: string
    updated_at: string
  }>
  const letterRequests = (lettersRes.data ?? []) as Array<{
    id: string
    letter_type_id: string
    resident_id: string
    requested_by_member_id: string
    purpose: string
    status: LetterRequestStatus
    letter_number: string | null
    created_at: string
    updated_at: string
  }>
  const letterTypes = (letterTypesRes.data ?? []) as Array<{
    id: string
    name: string
    code: string
  }>
  const tenantMembers = (membersRes.data ?? []) as Array<{
    id: string
    resident_id: string | null
  }>

  // Lookup maps (zero N+1)
  const householdMap = new Map(households.map((h) => [h.id, h]))
  const residentMap = new Map(residents.map((r) => [r.id, r]))
  const dueMap = new Map(dues.map((d) => [d.id, d]))
  const billMap = new Map(bills.map((b) => [b.id, b]))
  const letterTypeMap = new Map(letterTypes.map((lt) => [lt.id, lt.name]))
  const memberResidentMap = new Map(
    tenantMembers.map((m) => [m.id, m.resident_id])
  )

  const resolveBillTargetLabel = (bill: (typeof bills)[number] | undefined) => {
    if (!bill) return "Tagihan RT"
    if (bill.resident_id) {
      const r = residentMap.get(bill.resident_id)
      if (r) {
        const hh = householdMap.get(r.household_id)
        return hh?.block_unit
          ? `${r.full_name} (${hh.block_unit})`
          : r.full_name
      }
      return "Warga Terdaftar"
    }
    if (bill.household_id) {
      const hh = householdMap.get(bill.household_id)
      if (hh) {
        const head = hh.head_resident_id
          ? residentMap.get(hh.head_resident_id)
          : null
        const unit = hh.block_unit ?? hh.address
        return head ? `KK ${head.full_name} (${unit})` : `KK ${unit}`
      }
      return "Kepala Keluarga"
    }
    return "Tagihan RT"
  }

  // 1. Residents & Households
  const activeResidentsCount = residents.filter(
    (r) => r.residency_status === "aktif"
  ).length
  const totalResidentsCount = residents.length
  const activeHouseholdsCount = households.filter(
    (h) => h.status === "active"
  ).length
  const totalHouseholdsCount = households.length

  // 2. Active Dues & Active Bills
  const activeDuesCount = dues.filter((d) => d.is_active).length
  const activeBillRows = bills.filter((b) =>
    ["unpaid", "partial", "overdue", "pending_verification"].includes(b.status)
  )
  let overdueBillsCount = 0
  let totalOutstandingAmount = 0
  for (const b of activeBillRows) {
    totalOutstandingAmount += Math.max(
      0,
      toNumeric(b.amount) - toNumeric(b.paid_amount)
    )
    if (isBillEffectivelyOverdue(b.status, b.due_date, todayIso)) {
      overdueBillsCount += 1
    }
  }
  const recentBills: BillSummary[] = activeBillRows.slice(0, 4).map((b) => {
    const due = dueMap.get(b.due_id)
    const amount = toNumeric(b.amount)
    const paidAmount = toNumeric(b.paid_amount)
    return {
      id: b.id,
      tenantId: b.tenant_id,
      dueId: b.due_id,
      dueName: due?.name ?? "Iuran",
      dueBillingCycle: (due?.billing_cycle ?? "monthly") as DuesBillingCycle,
      dueTargetScope: (due?.target_scope ?? "household") as DuesTargetScope,
      householdId: b.household_id,
      residentId: b.resident_id,
      targetLabel: resolveBillTargetLabel(b),
      periodYear: b.period_year,
      periodMonth: b.period_month,
      amount,
      paidAmount,
      remainingAmount: Math.max(0, roundMoney(amount - paidAmount)),
      dueDate: b.due_date,
      status: b.status as BillStatus,
      paidAt: b.paid_at,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }
  })

  // 3. Cash Transactions (cumulative ledger balance + period totals + trend)
  let totalLedgerIncome = 0
  let totalLedgerExpense = 0
  let periodIncome = 0
  let periodExpense = 0

  const cashTrend: CashTrendBucket[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    income: 0,
    expense: 0,
    net: 0,
  }))

  for (const tx of cashTransactions) {
    const amount = toNumeric(tx.amount)
    if (tx.type === "income") {
      totalLedgerIncome += amount
    } else {
      totalLedgerExpense += amount
    }

    if (
      tx.transaction_date >= filter.startDate &&
      tx.transaction_date <= filter.endDate
    ) {
      if (tx.type === "income") {
        periodIncome += amount
      } else {
        periodExpense += amount
      }

      const idx = findBucketIndex(buckets, tx.transaction_date)
      if (idx >= 0) {
        if (tx.type === "income") {
          cashTrend[idx].income = roundMoney(cashTrend[idx].income + amount)
        } else {
          cashTrend[idx].expense = roundMoney(cashTrend[idx].expense + amount)
        }
        cashTrend[idx].net = roundMoney(
          cashTrend[idx].income - cashTrend[idx].expense
        )
      }
    }
  }

  // 4. Verified Payments & Payment Trend
  const paymentTrend: PaymentTrendBucket[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    verifiedAmount: 0,
    refundedAmount: 0,
    netAmount: 0,
    verifiedCount: 0,
  }))

  let grossVerifiedInPeriod = 0
  let refundsInPeriod = 0
  let verifiedPaymentsCount = 0
  let pendingVerificationPaymentsCount = 0

  for (const p of payments) {
    if (
      p.payment_type === "payment" &&
      p.status === "pending" &&
      p.proof_storage_path !== null
    ) {
      pendingVerificationPaymentsCount += 1
    }

    const effectiveDate = toJakartaIsoDate(p.verified_at ?? p.paid_at)
    if (
      !effectiveDate ||
      effectiveDate < filter.startDate ||
      effectiveDate > filter.endDate
    ) {
      continue
    }

    const amount = toNumeric(p.amount)
    const idx = findBucketIndex(buckets, effectiveDate)

    if (
      p.payment_type === "payment" &&
      (p.status === "verified" || p.status === "refunded")
    ) {
      grossVerifiedInPeriod += amount
      if (p.status === "verified") {
        verifiedPaymentsCount += 1
      }
      if (idx >= 0) {
        paymentTrend[idx].verifiedAmount = roundMoney(
          paymentTrend[idx].verifiedAmount + amount
        )
        if (p.status === "verified") {
          paymentTrend[idx].verifiedCount += 1
        }
      }
    } else if (p.payment_type === "refund" && p.status === "verified") {
      refundsInPeriod += amount
      if (idx >= 0) {
        paymentTrend[idx].refundedAmount = roundMoney(
          paymentTrend[idx].refundedAmount + amount
        )
      }
    }
  }

  for (const b of paymentTrend) {
    b.netAmount = Math.max(0, roundMoney(b.verifiedAmount - b.refundedAmount))
  }

  // 5. Complaints KPI & Trend
  let openComplaintsCount = 0
  let inProgressComplaintsCount = 0

  const complaintTrend: ComplaintTrendBucket[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    open: 0,
    inProgress: 0,
    resolved: 0,
    rejected: 0,
    total: 0,
  }))

  for (const c of complaints) {
    if (c.status === "open") openComplaintsCount += 1
    if (c.status === "in_progress") inProgressComplaintsCount += 1

    const cDate = toJakartaIsoDate(c.created_at)
    if (cDate >= filter.startDate && cDate <= filter.endDate) {
      const idx = findBucketIndex(buckets, cDate)
      if (idx >= 0) {
        if (c.status === "open") complaintTrend[idx].open += 1
        else if (c.status === "in_progress") complaintTrend[idx].inProgress += 1
        else if (c.status === "resolved") complaintTrend[idx].resolved += 1
        else if (c.status === "rejected") complaintTrend[idx].rejected += 1
        complaintTrend[idx].total += 1
      }
    }
  }

  // 6. Letter Requests KPI & Distribution
  let submittedLettersCount = 0
  let reviewingLettersCount = 0
  const periodLetterCounts = new Map<LetterRequestStatus, number>(
    LETTER_STATUSES_ORDER.map((s) => [s, 0])
  )
  let totalLettersInPeriod = 0

  for (const lr of letterRequests) {
    if (lr.status === "submitted") submittedLettersCount += 1
    if (lr.status === "reviewing") reviewingLettersCount += 1

    const lrDate = toJakartaIsoDate(lr.created_at)
    if (lrDate >= filter.startDate && lrDate <= filter.endDate) {
      periodLetterCounts.set(
        lr.status,
        (periodLetterCounts.get(lr.status) ?? 0) + 1
      )
      totalLettersInPeriod += 1
    }
  }

  const letterDistribution: LetterDistributionItem[] =
    LETTER_STATUSES_ORDER.map((status) => {
      const count = periodLetterCounts.get(status) ?? 0
      return {
        status,
        label: LETTER_STATUS_LABELS[status],
        count,
        percentage:
          totalLettersInPeriod > 0
            ? Math.round((count / totalLettersInPeriod) * 100)
            : 0,
      }
    })

  // 7. Recent Payments, Complaints, Letters
  const recentPayments: AdminRecentPaymentItem[] = payments
    .filter(
      (p) =>
        p.payment_type === "payment" &&
        !(p.status === "pending" && p.proof_storage_path === null)
    )
    .slice(0, 12)
    .map((p) => {
      const bill = billMap.get(p.bill_id)
      const due = bill ? dueMap.get(bill.due_id) : undefined
      return {
        id: p.id,
        billId: p.bill_id,
        targetLabel: resolveBillTargetLabel(bill),
        dueName: due?.name ?? "Iuran RT",
        periodYear: bill?.period_year ?? new Date().getUTCFullYear(),
        periodMonth: bill?.period_month ?? 1,
        amount: toNumeric(p.amount),
        paymentMethod: p.payment_method,
        status: p.status,
        paidAt: p.paid_at,
        verifiedAt: p.verified_at,
        createdAt: p.created_at,
      }
    })

  const recentComplaints: AdminRecentComplaintItem[] = complaints
    .slice(0, 12)
    .map((c) => {
      const linkedResidentId = memberResidentMap.get(c.reporter_member_id)
      const resident = linkedResidentId
        ? residentMap.get(linkedResidentId)
        : null
      const hh = resident ? householdMap.get(resident.household_id) : null
      const reporterLabel = resident
        ? hh?.block_unit
          ? `${resident.full_name} (${hh.block_unit})`
          : resident.full_name
        : "Anggota RT"

      return {
        id: c.id,
        title: c.title,
        category: c.category,
        priority: c.priority,
        status: c.status,
        reporterLabel,
        createdAt: c.created_at,
      }
    })

  const recentLetters: AdminRecentLetterItem[] = letterRequests
    .slice(0, 12)
    .map((lr) => {
      const resident = residentMap.get(lr.resident_id)
      const hh = resident ? householdMap.get(resident.household_id) : null
      const residentName = resident
        ? hh?.block_unit
          ? `${resident.full_name} (${hh.block_unit})`
          : resident.full_name
        : "Warga Terdaftar"

      return {
        id: lr.id,
        letterTypeName: letterTypeMap.get(lr.letter_type_id) ?? "Surat RT",
        residentName,
        purpose: lr.purpose,
        status: lr.status,
        letterNumber: lr.letter_number,
        createdAt: lr.created_at,
      }
    })

  // 8. Unified Chronological Activity Feed + Pagination
  const combinedActivities: AdminActivityFeedItem[] = [
    ...recentPayments.map((p) => ({
      id: `pay-${p.id}`,
      category: "payment" as const,
      title: `Pembayaran ${p.dueName}`,
      detail: `${p.targetLabel} • ${formatBillPeriod(p.periodYear, p.periodMonth)} • ${PAYMENT_METHOD_LABELS[p.paymentMethod]} (${formatIdr(p.amount)})`,
      statusLabel: PAYMENT_STATUS_LABELS[p.status],
      statusVariant: getPaymentStatusBadgeVariant(p.status),
      timestamp: p.verifiedAt ?? p.paidAt,
      href: `/payments/${p.id}`,
    })),
    ...recentComplaints.map((c) => ({
      id: `cmp-${c.id}`,
      category: "complaint" as const,
      title: c.title,
      detail: `${c.reporterLabel} • Kategori ${c.category}`,
      statusLabel: COMPLAINT_STATUS_LABELS[c.status],
      statusVariant: getComplaintStatusBadgeVariant(c.status),
      timestamp: c.createdAt,
      href: null,
    })),
    ...recentLetters.map((lr) => ({
      id: `ltr-${lr.id}`,
      category: "letter" as const,
      title: lr.letterTypeName,
      detail: `${lr.residentName} • ${lr.purpose}`,
      statusLabel: LETTER_STATUS_LABELS[lr.status],
      statusVariant: getLetterStatusBadgeVariant(lr.status),
      timestamp: lr.createdAt,
      href: null,
    })),
    ...recentAnnouncements.map((ann) => ({
      id: `ann-${ann.id}`,
      category: "announcement" as const,
      title: ann.title,
      detail: `Pengumuman RT (${ann.targetType})`,
      statusLabel: ANNOUNCEMENT_STATUS_LABELS[ann.status],
      statusVariant:
        ann.status === "published"
          ? ("success" as const)
          : ann.status === "draft"
            ? ("warning" as const)
            : ("outline" as const),
      timestamp: ann.publishedAt ?? ann.updatedAt,
      href: `/announcements/${ann.id}`,
    })),
  ].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))

  const filteredActivities =
    activityCategory === "all"
      ? combinedActivities
      : combinedActivities.filter((a) => a.category === activityCategory)

  const safePageSize = Math.min(Math.max(activityPageSize, 3), 20)
  const totalCount = filteredActivities.length
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize))
  const clampedPage = Math.min(Math.max(1, activityPage), totalPages)
  const startIdx = (clampedPage - 1) * safePageSize

  return {
    tenantId,
    tenantName,
    tenantSubtitle,
    period: filter,
    kpis: {
      activeResidentsCount,
      totalResidentsCount,
      activeHouseholdsCount,
      totalHouseholdsCount,
      activeBillsCount: activeBillRows.length,
      overdueBillsCount,
      totalOutstandingAmount: roundMoney(totalOutstandingAmount),
      activeDuesCount,
      verifiedPaymentsNetAmount: Math.max(
        0,
        roundMoney(grossVerifiedInPeriod - refundsInPeriod)
      ),
      verifiedPaymentsCount,
      pendingVerificationPaymentsCount,
      cashBalance: roundMoney(totalLedgerIncome - totalLedgerExpense),
      totalLedgerIncome: roundMoney(totalLedgerIncome),
      totalLedgerExpense: roundMoney(totalLedgerExpense),
      periodIncome: roundMoney(periodIncome),
      periodExpense: roundMoney(periodExpense),
      periodNet: roundMoney(periodIncome - periodExpense),
      unfinishedComplaintsCount:
        openComplaintsCount + inProgressComplaintsCount,
      openComplaintsCount,
      inProgressComplaintsCount,
      pendingLettersCount: submittedLettersCount + reviewingLettersCount,
      submittedLettersCount,
      reviewingLettersCount,
    },
    cashTrend,
    paymentTrend,
    complaintTrend,
    letterDistribution,
    totalLettersInPeriod,
    recentPayments: recentPayments.slice(0, 6),
    recentComplaints: recentComplaints.slice(0, 5),
    recentLetters: recentLetters.slice(0, 5),
    recentBills,
    recentAnnouncements: recentAnnouncements.slice(0, 4),
    activityFeed: {
      items: filteredActivities.slice(startIdx, startIdx + safePageSize),
      totalCount,
      page: clampedPage,
      pageSize: safePageSize,
      totalPages,
    },
    error: null,
  }
}

export async function buildAdminAnalyticsCsv({
  tenantId,
  tenantName,
  tenantSubtitle,
  period,
}: {
  tenantId: string
  tenantName: string
  tenantSubtitle: string
  period: ResolvedAnalyticsPeriod
}): Promise<string> {
  const supabase = await createClient()
  const [analytics, categoriesRes, txRes] = await Promise.all([
    getAdminDashboardAnalytics({
      tenantId,
      tenantName,
      tenantSubtitle,
      filter: period,
      activityPage: 1,
      activityPageSize: 10,
    }),
    supabase
      .from("cash_categories")
      .select("id, name")
      .eq("tenant_id", tenantId),
    supabase
      .from("cash_transactions")
      .select("id, category_id, type, amount, transaction_date, description")
      .eq("tenant_id", tenantId)
      .gte("transaction_date", period.startDate)
      .lte("transaction_date", period.endDate)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ])

  const catMap = new Map(
    ((categoriesRes.data ?? []) as Array<{ id: string; name: string }>).map(
      (c) => [c.id, c.name]
    )
  )

  const lines: string[] = []
  const pushRow = (cells: Array<string | number | null | undefined>) => {
    lines.push(cells.map(escapeCsvCell).join(","))
  }

  pushRow(["Laporan Analitik Operasional Smart RT"])
  pushRow(["Wilayah", `${tenantName} (${tenantSubtitle})`])
  pushRow(["Periode", analytics.period.label])
  pushRow(["Rentang Tanggal", `${analytics.period.startDate} s/d ${analytics.period.endDate}`])
  pushRow([])

  pushRow(["Ringkasan Statistik Utama", "Nilai"])
  pushRow(["Warga Aktif", analytics.kpis.activeResidentsCount])
  pushRow(["Total Warga Tercatat", analytics.kpis.totalResidentsCount])
  pushRow(["Kepala Keluarga Aktif", analytics.kpis.activeHouseholdsCount])
  pushRow(["Tagihan Aktif", analytics.kpis.activeBillsCount])
  pushRow(["Tagihan Jatuh Tempo", analytics.kpis.overdueBillsCount])
  pushRow(["Total Piutang Tagihan (IDR)", analytics.kpis.totalOutstandingAmount])
  pushRow(["Pembayaran Terverifikasi Neto Periode (IDR)", analytics.kpis.verifiedPaymentsNetAmount])
  pushRow(["Jumlah Pembayaran Terverifikasi Periode", analytics.kpis.verifiedPaymentsCount])
  pushRow(["Saldo Kas Ledger Kumulatif (IDR)", analytics.kpis.cashBalance])
  pushRow(["Pemasukan Kas Periode (IDR)", analytics.kpis.periodIncome])
  pushRow(["Pengeluaran Kas Periode (IDR)", analytics.kpis.periodExpense])
  pushRow(["Pengaduan Belum Selesai", analytics.kpis.unfinishedComplaintsCount])
  pushRow(["Permohonan Surat Menunggu", analytics.kpis.pendingLettersCount])
  pushRow([])

  pushRow([
    "Tren Periode",
    "Pemasukan Kas (IDR)",
    "Pengeluaran Kas (IDR)",
    "Arus Bersih Kas (IDR)",
    "Pembayaran Iuran Neto (IDR)",
    "Jumlah Pengaduan",
  ])
  for (let i = 0; i < analytics.cashTrend.length; i++) {
    const cashRow = analytics.cashTrend[i]
    const payRow = analytics.paymentTrend[i]
    const cmpRow = analytics.complaintTrend[i]
    pushRow([
      cashRow.label,
      cashRow.income,
      cashRow.expense,
      cashRow.net,
      payRow?.netAmount ?? 0,
      cmpRow?.total ?? 0,
    ])
  }
  pushRow([])

  pushRow(["Distribusi Status Permohonan Surat (Periode)", "Jumlah", "Persentase (%)"])
  for (const item of analytics.letterDistribution) {
    pushRow([item.label, item.count, item.percentage])
  }
  pushRow([])

  pushRow(["Daftar Transaksi Kas Dalam Periode", "Tanggal", "Jenis", "Kategori", "Nominal (IDR)", "Keterangan"])
  const txRows = (txRes.data ?? []) as Array<{
    id: string
    category_id: string
    type: CashTransactionType
    amount: number | string
    transaction_date: string
    description: string
  }>
  for (const tx of txRows) {
    pushRow([
      tx.id,
      tx.transaction_date,
      tx.type === "income" ? "Pemasukan" : "Pengeluaran",
      catMap.get(tx.category_id) ?? "Lainnya",
      toNumeric(tx.amount),
      tx.description,
    ])
  }

  return `\uFEFF${lines.join("\r\n")}`
}

export async function getResidentDashboardData({
  tenantId,
  tenantName,
  tenantSubtitle,
  userId,
  memberId,
  residentId,
}: {
  tenantId: string
  tenantName: string
  tenantSubtitle: string
  userId: string
  memberId: string
  residentId: string | null
}): Promise<ResidentDashboardData> {
  const supabase = await createClient()

  const letterFilterQuery = supabase
    .from("letter_requests")
    .select(
      "id, letter_type_id, purpose, status, letter_number, created_at"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })

  const scopedLetterQuery = residentId
    ? letterFilterQuery.or(
        `requested_by_member_id.eq.${memberId},resident_id.eq.${residentId}`
      )
    : letterFilterQuery.eq("requested_by_member_id", memberId)

  const [
    portalData,
    billsPortal,
    recentAnnouncements,
    complaintsRes,
    lettersRes,
    letterTypesRes,
    unreadNotifsRes,
    activitiesRes,
  ] = await Promise.all([
    getResidentPortalData({
      tenantId,
      userId,
      includePrivateProfile: false,
    }),
    getResidentBillsPortal(tenantId),
    getRecentResidentAnnouncements(tenantId, 3),
    supabase
      .from("complaints")
      .select("id, category, title, priority, status, created_at")
      .eq("tenant_id", tenantId)
      .eq("reporter_member_id", memberId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    scopedLetterQuery,
    supabase
      .from("letter_types")
      .select("id, name")
      .eq("tenant_id", tenantId),
    supabase
      .from("notifications")
      .select("id, title, body, type, created_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", userId)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("activities")
      .select("id, title, location, start_at, end_at, status")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("status", ["scheduled", "ongoing"])
      .order("start_at", { ascending: true })
      .limit(3),
  ])

  const upcomingBills = billsPortal.items
    .filter((b) =>
      ["unpaid", "partial", "pending_verification", "overdue"].includes(
        b.status
      )
    )
    .slice(0, 3)

  const pendingVerificationCount = billsPortal.items.filter(
    (b) => b.status === "pending_verification"
  ).length

  const paidBillsCount = billsPortal.items.filter(
    (b) => b.status === "paid"
  ).length

  // Own payments ONLY (filtered via ownBillIds + RLS payments_select)
  const ownBillMap = new Map(billsPortal.items.map((b) => [b.id, b]))
  const ownBillIds = billsPortal.items.map((b) => b.id)

  let verifiedCount = 0
  let verifiedTotalAmount = 0
  let pendingPaymentCount = 0
  let rejectedPaymentCount = 0
  let recentPayments: ResidentDashboardData["paymentSummary"]["recentPayments"] =
    []

  if (ownBillIds.length > 0) {
    const { data: paymentRows } = await supabase
      .from("payments")
      .select(
        "id, bill_id, payment_type, amount, payment_method, proof_storage_path, status, paid_at, verified_at, created_at"
      )
      .eq("tenant_id", tenantId)
      .in("bill_id", ownBillIds)
      .order("created_at", { ascending: false })

    const rawPayments = (paymentRows ?? []) as Array<{
      id: string
      bill_id: string
      payment_type: PaymentType
      amount: number | string
      payment_method: PaymentMethod
      proof_storage_path: string | null
      status: PaymentStatus
      paid_at: string
      verified_at: string | null
      created_at: string
    }>

    for (const p of rawPayments) {
      const amount = toNumeric(p.amount)
      if (
        p.payment_type === "payment" &&
        (p.status === "verified" || p.status === "refunded")
      ) {
        if (p.status === "verified") verifiedCount += 1
        verifiedTotalAmount += amount
      } else if (p.payment_type === "refund" && p.status === "verified") {
        verifiedTotalAmount -= amount
      } else if (p.payment_type === "payment" && p.status === "pending") {
        pendingPaymentCount += 1
      } else if (p.payment_type === "payment" && p.status === "rejected") {
        rejectedPaymentCount += 1
      }
    }

    recentPayments = rawPayments
      .filter((p) => p.payment_type === "payment")
      .slice(0, 4)
      .map((p) => {
        const bill = ownBillMap.get(p.bill_id)
        return {
          id: p.id,
          billId: p.bill_id,
          dueName: bill?.dueName ?? "Iuran RT",
          periodYear: bill?.periodYear ?? new Date().getUTCFullYear(),
          periodMonth: bill?.periodMonth ?? 1,
          amount: toNumeric(p.amount),
          paymentMethod: p.payment_method,
          status: p.status,
          hasProof: p.proof_storage_path !== null,
          paidAt: p.paid_at,
          verifiedAt: p.verified_at,
        }
      })
  }

  // Personal complaints
  const rawComplaints = (complaintsRes.data ?? []) as Array<{
    id: string
    category: string
    title: string
    priority: ComplaintPriority
    status: ComplaintStatus
    created_at: string
  }>
  const complaintsSummary: ResidentDashboardData["complaintsSummary"] = {
    openCount: rawComplaints.filter((c) => c.status === "open").length,
    inProgressCount: rawComplaints.filter((c) => c.status === "in_progress")
      .length,
    resolvedCount: rawComplaints.filter((c) => c.status === "resolved").length,
    rejectedCount: rawComplaints.filter((c) => c.status === "rejected").length,
    totalCount: rawComplaints.length,
    recent: rawComplaints.slice(0, 4).map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      priority: c.priority,
      status: c.status,
      createdAt: c.created_at,
    })),
  }

  // Personal letters
  const ltMap = new Map(
    ((letterTypesRes.data ?? []) as Array<{ id: string; name: string }>).map(
      (lt) => [lt.id, lt.name]
    )
  )
  const rawLetters = (lettersRes.data ?? []) as Array<{
    id: string
    letter_type_id: string
    purpose: string
    status: LetterRequestStatus
    letter_number: string | null
    created_at: string
  }>
  const lettersSummary: ResidentDashboardData["lettersSummary"] = {
    submittedCount: rawLetters.filter((l) => l.status === "submitted").length,
    reviewingCount: rawLetters.filter((l) => l.status === "reviewing").length,
    approvedCount: rawLetters.filter((l) => l.status === "approved").length,
    completedCount: rawLetters.filter((l) => l.status === "completed").length,
    rejectedCount: rawLetters.filter((l) => l.status === "rejected").length,
    cancelledCount: rawLetters.filter((l) => l.status === "cancelled").length,
    totalCount: rawLetters.length,
    recent: rawLetters.slice(0, 4).map((l) => ({
      id: l.id,
      letterTypeName: ltMap.get(l.letter_type_id) ?? "Surat Pengantar",
      purpose: l.purpose,
      status: l.status,
      letterNumber: l.letter_number,
      createdAt: l.created_at,
    })),
  }

  const rawNotifs = (unreadNotifsRes.data ?? []) as Array<{
    id: string
    title: string
    body: string
    type: string
    created_at: string
  }>

  const rawActivities = (activitiesRes.data ?? []) as Array<{
    id: string
    title: string
    location: string
    start_at: string
    end_at: string | null
    status: ActivityStatus
  }>

  return {
    tenantName,
    tenantSubtitle,
    linked: portalData.linked,
    residentProfile:
      portalData.linked && portalData.resident
        ? {
            fullName: portalData.resident.fullName,
            residencyStatus: portalData.resident.residencyStatus,
            unitLabel:
              portalData.household?.blockUnit ??
              portalData.household?.address ??
              "Terdaftar",
            address: portalData.household?.address ?? "-",
            familyMembersCount: portalData.householdMembers.length,
          }
        : null,
    financeSummary: {
      outstandingCount: billsPortal.outstandingCount,
      overdueCount: billsPortal.overdueCount,
      pendingVerificationCount,
      totalOutstandingAmount: billsPortal.totalOutstandingAmount,
      upcomingBills,
    },
    paymentSummary: {
      verifiedCount,
      verifiedTotalAmount: Math.max(0, roundMoney(verifiedTotalAmount)),
      pendingCount: pendingPaymentCount,
      rejectedCount: rejectedPaymentCount,
      paidBillsCount,
      totalBillsCount: billsPortal.items.length,
      recentPayments,
    },
    complaintsSummary,
    lettersSummary,
    unreadNotifications: {
      unreadCount: unreadNotifsRes.count ?? rawNotifs.length,
      recent: rawNotifs.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        type: n.type,
        createdAt: n.created_at,
      })),
    },
    recentAnnouncements,
    upcomingActivities: rawActivities.map((a) => ({
      id: a.id,
      title: a.title,
      location: a.location,
      startAt: a.start_at,
      endAt: a.end_at,
      status: a.status,
    })),
  }
}

export { INDONESIAN_MONTH_NAMES }

