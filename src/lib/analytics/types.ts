import type { AnnouncementSummary, ResidentAnnouncementItem } from "@/lib/announcements/types"
import type {
  BillStatus,
  BillSummary,
  PaymentMethod,
  PaymentStatus,
  ResidentFinanceDashboardSummary,
} from "@/lib/finance/types"
import type { ResidencyStatus } from "@/lib/residents/types"

export type AnalyticsPeriodMode =
  | "last_6_months"
  | "monthly"
  | "yearly"
  | "custom"

export type AnalyticsActivityCategory =
  | "all"
  | "payment"
  | "complaint"
  | "letter"
  | "announcement"

export type ComplaintStatus = "open" | "in_progress" | "resolved" | "rejected"
export type ComplaintPriority = "low" | "medium" | "high"

export type LetterRequestStatus =
  | "submitted"
  | "reviewing"
  | "approved"
  | "rejected"
  | "completed"
  | "cancelled"

export type ActivityStatus =
  | "scheduled"
  | "ongoing"
  | "completed"
  | "cancelled"

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: "Menunggu",
  in_progress: "Diproses",
  resolved: "Selesai",
  rejected: "Ditolak",
}

export const COMPLAINT_PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
}

export const LETTER_STATUS_LABELS: Record<LetterRequestStatus, string> = {
  submitted: "Diajukan",
  reviewing: "Ditinjau",
  approved: "Disetujui",
  rejected: "Ditolak",
  completed: "Selesai",
  cancelled: "Dibatalkan",
}

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  scheduled: "Terjadwal",
  ongoing: "Berlangsung",
  completed: "Selesai",
  cancelled: "Dibatalkan",
}

export function getComplaintStatusBadgeVariant(
  status: ComplaintStatus
): "warning" | "info" | "success" | "destructive" {
  switch (status) {
    case "open":
      return "warning"
    case "in_progress":
      return "info"
    case "resolved":
      return "success"
    case "rejected":
      return "destructive"
  }
}

export function getComplaintPriorityBadgeVariant(
  priority: ComplaintPriority
): "outline" | "warning" | "destructive" {
  switch (priority) {
    case "low":
      return "outline"
    case "medium":
      return "warning"
    case "high":
      return "destructive"
  }
}

export function getLetterStatusBadgeVariant(
  status: LetterRequestStatus
): "warning" | "info" | "success" | "destructive" | "outline" {
  switch (status) {
    case "submitted":
      return "warning"
    case "reviewing":
      return "info"
    case "approved":
    case "completed":
      return "success"
    case "rejected":
      return "destructive"
    case "cancelled":
      return "outline"
  }
}

export interface AnalyticsFilterInput {
  periodMode: AnalyticsPeriodMode
  year: number
  month: number
  startDate: string
  endDate: string
}

export interface ResolvedAnalyticsPeriod {
  periodMode: AnalyticsPeriodMode
  year: number
  month: number
  startDate: string
  endDate: string
  label: string
  granularity: "month" | "week"
}

export interface CashTrendBucket {
  key: string
  label: string
  income: number
  expense: number
  net: number
}

export interface PaymentTrendBucket {
  key: string
  label: string
  verifiedAmount: number
  refundedAmount: number
  netAmount: number
  verifiedCount: number
}

export interface ComplaintTrendBucket {
  key: string
  label: string
  open: number
  inProgress: number
  resolved: number
  rejected: number
  total: number
}

export interface LetterDistributionItem {
  status: LetterRequestStatus
  label: string
  count: number
  percentage: number
}

export interface AdminRecentPaymentItem {
  id: string
  billId: string
  targetLabel: string
  dueName: string
  periodYear: number
  periodMonth: number
  amount: number
  paymentMethod: PaymentMethod
  status: PaymentStatus
  paidAt: string
  verifiedAt: string | null
  createdAt: string
}

export interface AdminRecentComplaintItem {
  id: string
  title: string
  category: string
  priority: ComplaintPriority
  status: ComplaintStatus
  reporterLabel: string
  createdAt: string
}

export interface AdminRecentLetterItem {
  id: string
  letterTypeName: string
  residentName: string
  purpose: string
  status: LetterRequestStatus
  letterNumber: string | null
  createdAt: string
}

export interface AdminActivityFeedItem {
  id: string
  category: Exclude<AnalyticsActivityCategory, "all">
  title: string
  detail: string
  statusLabel: string
  statusVariant: "success" | "warning" | "destructive" | "info" | "outline"
  timestamp: string
  href: string | null
}

export interface AdminActivityFeedPage {
  items: AdminActivityFeedItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export interface AdminAnalyticsKpis {
  activeResidentsCount: number
  totalResidentsCount: number
  activeHouseholdsCount: number
  totalHouseholdsCount: number
  activeBillsCount: number
  overdueBillsCount: number
  totalOutstandingAmount: number
  activeDuesCount: number
  verifiedPaymentsNetAmount: number
  verifiedPaymentsCount: number
  pendingVerificationPaymentsCount: number
  cashBalance: number
  totalLedgerIncome: number
  totalLedgerExpense: number
  periodIncome: number
  periodExpense: number
  periodNet: number
  unfinishedComplaintsCount: number
  openComplaintsCount: number
  inProgressComplaintsCount: number
  pendingLettersCount: number
  submittedLettersCount: number
  reviewingLettersCount: number
}

export interface AdminDashboardAnalyticsData {
  tenantId: string
  tenantName: string
  tenantSubtitle: string
  period: ResolvedAnalyticsPeriod
  kpis: AdminAnalyticsKpis
  cashTrend: CashTrendBucket[]
  paymentTrend: PaymentTrendBucket[]
  complaintTrend: ComplaintTrendBucket[]
  letterDistribution: LetterDistributionItem[]
  totalLettersInPeriod: number
  recentPayments: AdminRecentPaymentItem[]
  recentComplaints: AdminRecentComplaintItem[]
  recentLetters: AdminRecentLetterItem[]
  recentBills: BillSummary[]
  recentAnnouncements: AnnouncementSummary[]
  activityFeed: AdminActivityFeedPage
  error: string | null
}

export interface ResidentPersonalPaymentItem {
  id: string
  billId: string
  dueName: string
  periodYear: number
  periodMonth: number
  amount: number
  paymentMethod: PaymentMethod
  status: PaymentStatus
  hasProof: boolean
  paidAt: string
  verifiedAt: string | null
}

export interface ResidentPersonalComplaintItem {
  id: string
  title: string
  category: string
  priority: ComplaintPriority
  status: ComplaintStatus
  createdAt: string
}

export interface ResidentPersonalLetterItem {
  id: string
  letterTypeName: string
  purpose: string
  status: LetterRequestStatus
  letterNumber: string | null
  createdAt: string
}

export interface ResidentUnreadNotificationPreview {
  id: string
  title: string
  body: string
  type: string
  createdAt: string
}

export interface ResidentCommunityActivityItem {
  id: string
  title: string
  location: string
  startAt: string
  endAt: string | null
  status: ActivityStatus
}

export interface ResidentDashboardData {
  tenantName: string
  tenantSubtitle: string
  linked: boolean
  residentProfile: {
    fullName: string
    residencyStatus: ResidencyStatus
    unitLabel: string
    address: string
    familyMembersCount: number
  } | null
  financeSummary: ResidentFinanceDashboardSummary
  paymentSummary: {
    verifiedCount: number
    verifiedTotalAmount: number
    pendingCount: number
    rejectedCount: number
    paidBillsCount: number
    totalBillsCount: number
    recentPayments: ResidentPersonalPaymentItem[]
  }
  complaintsSummary: {
    openCount: number
    inProgressCount: number
    resolvedCount: number
    rejectedCount: number
    totalCount: number
    recent: ResidentPersonalComplaintItem[]
  }
  lettersSummary: {
    submittedCount: number
    reviewingCount: number
    approvedCount: number
    completedCount: number
    rejectedCount: number
    cancelledCount: number
    totalCount: number
    recent: ResidentPersonalLetterItem[]
  }
  unreadNotifications: {
    unreadCount: number
    recent: ResidentUnreadNotificationPreview[]
  }
  recentAnnouncements: ResidentAnnouncementItem[]
  upcomingActivities: ResidentCommunityActivityItem[]
}

export type AdminBillStatusQuick = BillStatus

