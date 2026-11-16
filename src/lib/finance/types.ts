import type { RoleCode } from "@/lib/auth/types"

export type DuesBillingCycle = "monthly" | "yearly" | "one_time"
export type DuesTargetScope = "household" | "resident"

export type BillStatus =
  | "unpaid"
  | "partial"
  | "pending_verification"
  | "paid"
  | "overdue"
  | "cancelled"
  | "refunded"

export type EditableBillStatus = "unpaid" | "overdue" | "cancelled"

export const DUES_MANAGEMENT_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "bendahara",
]

export const BILLS_MANAGEMENT_ROLES: readonly RoleCode[] = ["bendahara"]

export const CASH_LEDGER_VIEW_ROLES: readonly RoleCode[] = [
  "ketua_rt",
  "sekretaris",
  "bendahara",
  "pengurus",
]

export function canManageDues(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => DUES_MANAGEMENT_ROLES.includes(role))
}

export function canManageBills(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => BILLS_MANAGEMENT_ROLES.includes(role))
}

export function canViewCashLedger(roles: readonly RoleCode[]): boolean {
  return roles.some((role) => CASH_LEDGER_VIEW_ROLES.includes(role))
}

export const STALE_INCOMPLETE_PAYMENT_HOURS = 24

export function isIncompletePaymentStale(
  createdAtIso: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!createdAtIso) return false
  const parsed = Date.parse(createdAtIso)
  if (!Number.isFinite(parsed)) return false
  const ageMs = nowMs - parsed
  return ageMs >= STALE_INCOMPLETE_PAYMENT_HOURS * 60 * 60 * 1000
}

export const DUES_BILLING_CYCLE_LABELS: Record<DuesBillingCycle, string> = {
  monthly: "Bulanan",
  yearly: "Tahunan",
  one_time: "Sekali Bayar",
}

export const DUES_TARGET_SCOPE_LABELS: Record<DuesTargetScope, string> = {
  household: "Per Kartu Keluarga",
  resident: "Per Warga",
}

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  unpaid: "Belum Dibayar",
  partial: "Dibayar Sebagian",
  pending_verification: "Menunggu Verifikasi",
  paid: "Lunas",
  overdue: "Jatuh Tempo",
  cancelled: "Dibatalkan",
  refunded: "Dikembalikan",
}

export const INDONESIAN_MONTH_NAMES: readonly string[] = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
]

export function getBillStatusBadgeVariant(
  status: BillStatus
): "success" | "warning" | "destructive" | "info" | "outline" {
  switch (status) {
    case "paid":
      return "success"
    case "unpaid":
    case "partial":
    case "pending_verification":
      return "warning"
    case "overdue":
      return "destructive"
    case "cancelled":
    case "refunded":
      return "outline"
  }
}

export function formatIdr(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0
  const hasDecimals = Math.round(safe * 100) % 100 !== 0
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(safe)
}

export function formatJakartaDate(value: string | null): string {
  if (!value) return "—"
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = dateOnly ? new Date(`${value}T00:00:00+07:00`) : new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed)
}

export function formatJakartaDateTime(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed)
}

export function formatBillPeriod(year: number, month: number): string {
  const monthLabel =
    month >= 1 && month <= 12 ? INDONESIAN_MONTH_NAMES[month - 1] : String(month)
  return `${monthLabel} ${year}`
}

export function getJakartaTodayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export function isBillEffectivelyOverdue(
  status: BillStatus,
  dueDate: string,
  todayIso: string
): boolean {
  if (status === "overdue") return true
  if (status === "unpaid" || status === "partial") {
    return dueDate < todayIso
  }
  return false
}

export interface DuesSummary {
  id: string
  tenantId: string
  name: string
  description: string | null
  amount: number
  billingCycle: DuesBillingCycle
  targetScope: DuesTargetScope
  isActive: boolean
  createdAt: string
  updatedAt: string
  billCount?: number
}

export interface BillSummary {
  id: string
  tenantId: string
  dueId: string
  dueName: string
  dueBillingCycle: DuesBillingCycle
  dueTargetScope: DuesTargetScope
  householdId: string | null
  residentId: string | null
  targetLabel: string
  periodYear: number
  periodMonth: number
  amount: number
  paidAmount: number
  remainingAmount: number
  dueDate: string
  status: BillStatus
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

export type PaymentType = "payment" | "refund"
export type PaymentMethod = "transfer" | "qris" | "cash" | "gateway"
export type ResidentPaymentMethod = "transfer" | "qris" | "cash"
export type PaymentStatus =
  | "pending"
  | "verified"
  | "failed"
  | "rejected"
  | "refunded"
export type CashTransactionType = "income" | "expense"

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: "Transfer Bank",
  qris: "QRIS",
  cash: "Tunai",
  gateway: "Payment Gateway",
}

export const RESIDENT_PAYMENT_METHOD_LABELS: Record<
  ResidentPaymentMethod,
  string
> = {
  transfer: "Transfer Bank",
  qris: "QRIS",
  cash: "Tunai",
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Menunggu Verifikasi",
  verified: "Terverifikasi",
  failed: "Gagal",
  rejected: "Ditolak",
  refunded: "Dikembalikan",
}

export function getPaymentStatusBadgeVariant(
  status: PaymentStatus
): "success" | "warning" | "destructive" | "info" | "outline" {
  switch (status) {
    case "verified":
      return "success"
    case "pending":
      return "warning"
    case "rejected":
    case "failed":
      return "destructive"
    case "refunded":
      return "outline"
  }
}

export interface BillPaymentSummary {
  id: string
  paymentType: PaymentType
  parentPaymentId?: string | null
  amount: number
  paymentMethod: PaymentMethod
  status: PaymentStatus
  proofStoragePath: string | null
  paidAt: string
  verifiedAt: string | null
  createdAt?: string
  notes: string | null
  rejectionReason: string | null
  rejectedAt: string | null
  hasUploadedProofInStorage?: boolean
  isStaleIncomplete?: boolean
}

export const CASH_TRANSACTION_TYPE_LABELS: Record<CashTransactionType, string> = {
  income: "Kas Masuk",
  expense: "Pengeluaran",
}

export interface CashCategorySummary {
  id: string
  tenantId: string
  name: string
  type: CashTransactionType
  isActive: boolean
}

export interface CashTransactionSummary {
  id: string
  tenantId: string
  categoryId: string
  categoryName: string
  paymentId: string | null
  type: CashTransactionType
  amount: number
  transactionDate: string
  description: string | null
  createdAt: string
  updatedAt?: string | null
}

export interface PaymentAuditEntry {
  id: string
  action: string
  createdAt: string
  reason: string | null
  reviewerNotes: string | null
  billStatus: string | null
}

export interface PaymentQueueItem {
  id: string
  tenantId: string
  billId: string
  dueName: string
  targetLabel: string
  periodYear: number
  periodMonth: number
  billAmount: number
  billPaidAmount: number
  billStatus: BillStatus
  paymentType: PaymentType
  amount: number
  paymentMethod: PaymentMethod
  status: PaymentStatus
  proofStoragePath: string | null
  notes: string | null
  paidAt: string
  verifiedAt: string | null
  createdAt: string
}

export interface PaymentDetailData {
  payment: PaymentQueueItem
  bill: BillSummary
  billPayments: BillPaymentSummary[]
  incomeCategories: CashCategorySummary[]
  expenseCategories: CashCategorySummary[]
  linkedCashTransaction: CashTransactionSummary | null
  refunds: BillPaymentSummary[]
  refundedAmount: number
  remainingRefundableAmount: number
  auditEntries: PaymentAuditEntry[]
}

export interface CashLedgerSummary {
  totalIncome: number
  totalExpense: number
  netBalance: number
  filteredIncome: number
  filteredExpense: number
  filteredNet: number
}

export interface DuesTargetHouseholdOption {
  id: string
  label: string
}

export interface DuesTargetResidentOption {
  id: string
  fullName: string
  householdLabel: string | null
}

export interface FinanceFormActionState {
  error: string | null
  fieldErrors?: Record<string, string[] | undefined>
  successMessage?: string | null
  generationResult?: {
    createdCount: number
    skippedCount: number
    failedCount: number
    totalNominal: number
  } | null
}

export interface AdminFinanceDashboardSummary {
  activeDuesCount: number
  outstandingBillCount: number
  overdueBillCount: number
  pendingVerificationCount: number
  totalOutstandingAmount: number
  recentBills: BillSummary[]
}

export interface ResidentFinanceDashboardSummary {
  outstandingCount: number
  overdueCount: number
  pendingVerificationCount: number
  totalOutstandingAmount: number
  upcomingBills: BillSummary[]
}

