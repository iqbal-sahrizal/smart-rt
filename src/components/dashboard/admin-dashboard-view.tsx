"use client"

import * as React from "react"
import Link from "next/link"
import {
  ActivityIcon,
  AlertCircleIcon,
  ArrowUpRightIcon,
  CalendarRangeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  HomeIcon,
  InboxIcon,
  MegaphoneIcon,
  MessageSquareWarningIcon,
  PiggyBankIcon,
  ReceiptIcon,
  RefreshCwIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"
import { cn } from "cn"

import {
  ComplaintTrendChart,
  LetterDistributionChart,
  PaymentTrendChart,
} from "@/components/dashboard/analytics-charts"
import { FinancialOverviewChart } from "@/components/dashboard/financial-overview-chart"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  COMPLAINT_PRIORITY_LABELS,
  COMPLAINT_STATUS_LABELS,
  getComplaintPriorityBadgeVariant,
  getComplaintStatusBadgeVariant,
  getLetterStatusBadgeVariant,
  LETTER_STATUS_LABELS,
  type AdminDashboardAnalyticsData,
  type AnalyticsActivityCategory,
  type AnalyticsPeriodMode,
} from "@/lib/analytics/types"
import {
  buildAnalyticsQueryString,
  useAdminAnalytics,
  type AdminAnalyticsQueryParams,
} from "@/lib/analytics/use-admin-analytics"
import {
  ANNOUNCEMENT_STATUS_LABELS,
  ANNOUNCEMENT_TARGET_LABELS,
  getAnnouncementStatusBadgeVariant,
} from "@/lib/announcements/types"
import {
  BILL_STATUS_LABELS,
  formatBillPeriod,
  formatIdr,
  formatJakartaDate,
  formatJakartaDateTime,
  getBillStatusBadgeVariant,
  getPaymentStatusBadgeVariant,
  INDONESIAN_MONTH_NAMES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/finance/types"

const PERIOD_MODE_OPTIONS: { value: AnalyticsPeriodMode; label: string }[] = [
  { value: "last_6_months", label: "6 Bulan Terakhir" },
  { value: "monthly", label: "Bulanan" },
  { value: "yearly", label: "Tahunan" },
  { value: "custom", label: "Rentang Tanggal" },
]

const ACTIVITY_TABS: { value: AnalyticsActivityCategory; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "payment", label: "Pembayaran" },
  { value: "complaint", label: "Pengaduan" },
  { value: "letter", label: "Surat" },
  { value: "announcement", label: "Pengumuman" },
]

interface AdminDashboardViewProps {
  initialAnalytics: AdminDashboardAnalyticsData
  canManageResidents: boolean
  canManageAnnouncements: boolean
  canManageDues: boolean
  canManageBills: boolean
  initialFilterError?: string | null
}

export function AdminDashboardView({
  initialAnalytics,
  canManageResidents,
  canManageAnnouncements,
  canManageDues,
  canManageBills,
  initialFilterError = null,
}: AdminDashboardViewProps) {
  const initialQueryParams = React.useMemo<AdminAnalyticsQueryParams>(
    () => ({
      periodMode: initialAnalytics.period.periodMode,
      year: initialAnalytics.period.year,
      month: initialAnalytics.period.month,
      startDate: initialAnalytics.period.startDate,
      endDate: initialAnalytics.period.endDate,
      activityCategory: "all",
      activityPage: 1,
      activityPageSize: 6,
    }),
    [initialAnalytics.period]
  )

  const initialKey = React.useMemo(
    () => buildAnalyticsQueryString(initialQueryParams),
    [initialQueryParams]
  )

  const [appliedParams, setAppliedParams] =
    React.useState<AdminAnalyticsQueryParams>(initialQueryParams)

  // Draft filter inputs before clicking Terapkan (for monthly/yearly/custom)
  const [draftMode, setDraftMode] = React.useState<AnalyticsPeriodMode>(
    initialAnalytics.period.periodMode
  )
  const [draftYear, setDraftYear] = React.useState<number>(
    initialAnalytics.period.year
  )
  const [draftMonth, setDraftMonth] = React.useState<number>(
    initialAnalytics.period.month
  )
  const [draftStartDate, setDraftStartDate] = React.useState<string>(
    initialAnalytics.period.startDate
  )
  const [draftEndDate, setDraftEndDate] = React.useState<string>(
    initialAnalytics.period.endDate
  )
  const [filterError, setFilterError] = React.useState<string | null>(
    initialFilterError
  )

  const currentKey = buildAnalyticsQueryString(appliedParams)
  const analyticsQuery = useAdminAnalytics({
    tenantId: initialAnalytics.tenantId,
    params: appliedParams,
    initialData: initialAnalytics,
    isInitialKey: currentKey === initialKey,
  })

  const data = analyticsQuery.data ?? initialAnalytics
  const { kpis } = data
  const isBusy = analyticsQuery.isFetching

  const yearOptions = React.useMemo(() => {
    const baseYear = initialAnalytics.period.year
    return [baseYear - 2, baseYear - 1, baseYear, baseYear + 1]
  }, [initialAnalytics.period.year])

  function applyFilter(nextPartial: Partial<AdminAnalyticsQueryParams>) {
    setFilterError(null)
    setAppliedParams((prev) => ({
      ...prev,
      ...nextPartial,
      activityPage: 1,
    }))
  }

  function handleModeSelect(mode: AnalyticsPeriodMode) {
    setDraftMode(mode)
    setFilterError(null)
    if (mode === "last_6_months") {
      applyFilter({ periodMode: "last_6_months" })
    } else if (mode === "monthly") {
      applyFilter({
        periodMode: "monthly",
        year: draftYear,
        month: draftMonth,
      })
    } else if (mode === "yearly") {
      applyFilter({
        periodMode: "yearly",
        year: draftYear,
      })
    }
  }

  function handleApplyCustomOrManual(e: React.FormEvent) {
    e.preventDefault()
    setFilterError(null)

    if (draftMode === "custom") {
      if (!draftStartDate || !draftEndDate) {
        setFilterError("Tanggal mulai dan tanggal akhir wajib diisi.")
        return
      }
      if (draftStartDate > draftEndDate) {
        setFilterError("Tanggal mulai tidak boleh melebihi tanggal akhir.")
        return
      }
      const spanDays =
        (Date.parse(`${draftEndDate}T00:00:00Z`) -
          Date.parse(`${draftStartDate}T00:00:00Z`)) /
        86_400_000
      if (spanDays > 731) {
        setFilterError("Rentang tanggal maksimal adalah 24 bulan (731 hari).")
        return
      }
      applyFilter({
        periodMode: "custom",
        startDate: draftStartDate,
        endDate: draftEndDate,
      })
      return
    }

    if (draftMode === "monthly") {
      applyFilter({
        periodMode: "monthly",
        year: draftYear,
        month: draftMonth,
      })
      return
    }

    if (draftMode === "yearly") {
      applyFilter({
        periodMode: "yearly",
        year: draftYear,
      })
      return
    }

    applyFilter({ periodMode: "last_6_months" })
  }

  function handleResetFilters() {
    setFilterError(null)
    setDraftMode("last_6_months")
    setAppliedParams({
      periodMode: "last_6_months",
      year: initialAnalytics.period.year,
      month: initialAnalytics.period.month,
      startDate: initialAnalytics.period.startDate,
      endDate: initialAnalytics.period.endDate,
      activityCategory: "all",
      activityPage: 1,
      activityPageSize: 6,
    })
  }

  const exportUrl = `/api/analytics/export?${buildAnalyticsQueryString({
    periodMode: data.period.periodMode,
    year: data.period.year,
    month: data.period.month,
    startDate: data.period.startDate,
    endDate: data.period.endDate,
  })}`

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard & Analitik"
        description={`Ringkasan operasional, warga, keuangan, dan layanan ${data.tenantName} (${data.tenantSubtitle}).`}
        actions={
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => void analyticsQuery.refetch()}
              className="gap-1.5"
            >
              <RefreshCwIcon
                className={cn("size-4", isBusy && "animate-spin")}
              />
              Muat Ulang
            </Button>
            <a
              href={exportUrl}
              download
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
            >
              <DownloadIcon className="size-3.5" />
              Ekspor CSV
            </a>
          </div>
        }
      />

      {/* Filter & Period Reporting Bar */}
      <Card size="sm">
        <CardContent className="flex flex-col gap-[var(--space-3)]">
          <div className="flex flex-col gap-[var(--space-3)] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {PERIOD_MODE_OPTIONS.map((opt) => {
                const active = draftMode === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleModeSelect(opt.value)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/70 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarRangeIcon className="size-3.5 shrink-0" />
              <span>
                Periode aktif:{" "}
                <strong className="font-medium text-foreground">
                  {data.period.label}
                </strong>
              </span>
            </div>
          </div>

          {draftMode !== "last_6_months" && (
            <form
              onSubmit={handleApplyCustomOrManual}
              className="flex flex-wrap items-end gap-[var(--space-3)] border-t border-border-subtle pt-[var(--space-3)]"
            >
              {draftMode === "monthly" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="analytics-month"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      Bulan
                    </label>
                    <select
                      id="analytics-month"
                      value={draftMonth}
                      onChange={(e) => setDraftMonth(Number(e.target.value))}
                      className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
                    >
                      {INDONESIAN_MONTH_NAMES.map((name, idx) => (
                        <option key={name} value={idx + 1}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="analytics-year-m"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      Tahun
                    </label>
                    <select
                      id="analytics-year-m"
                      value={draftYear}
                      onChange={(e) => setDraftYear(Number(e.target.value))}
                      className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
                    >
                      {yearOptions.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {draftMode === "yearly" && (
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="analytics-year-y"
                    className="text-[11px] font-medium text-muted-foreground"
                  >
                    Tahun Laporan
                  </label>
                  <select
                    id="analytics-year-y"
                    value={draftYear}
                    onChange={(e) => setDraftYear(Number(e.target.value))}
                    className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
                  >
                    {yearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {draftMode === "custom" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="analytics-start-date"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      Dari Tanggal
                    </label>
                    <Input
                      id="analytics-start-date"
                      type="date"
                      value={draftStartDate}
                      onChange={(e) => setDraftStartDate(e.target.value)}
                      className="h-9 w-full text-xs sm:w-40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="analytics-end-date"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      Sampai Tanggal
                    </label>
                    <Input
                      id="analytics-end-date"
                      type="date"
                      value={draftEndDate}
                      onChange={(e) => setDraftEndDate(e.target.value)}
                      className="h-9 w-full text-xs sm:w-40"
                    />
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={isBusy}>
                  Terapkan Filter
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                >
                  Reset
                </Button>
              </div>
            </form>
          )}

          {(filterError || analyticsQuery.isError) && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-destructive-border bg-destructive-subtle px-3 py-2 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="size-4 shrink-0" />
              <span>
                {filterError ??
                  analyticsQuery.error?.message ??
                  "Gagal memperbarui data laporan."}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 7 Real KPI Cards */}
      <section
        aria-label="Statistik Utama RT"
        className="grid gap-[var(--space-4)] sm:grid-cols-2 xl:grid-cols-4"
      >
        <Link href="/residents" className="group block">
          <Card
            size="sm"
            className="h-full transition-colors duration-150 group-hover:border-border-strong"
          >
            <CardHeader className="pb-0">
              <CardDescription className="text-xs font-medium text-muted-foreground">
                Warga Aktif
              </CardDescription>
              <CardAction>
                <div className="flex size-8 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground">
                  <UsersIcon className="size-[var(--size-icon-md)]" />
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                {kpis.activeResidentsCount}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Total tercatat: {kpis.totalResidentsCount} jiwa
                </span>
                <Badge variant="info" size="sm">
                  Kependudukan
                </Badge>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/residents" className="group block">
          <Card
            size="sm"
            className="h-full transition-colors duration-150 group-hover:border-border-strong"
          >
            <CardHeader className="pb-0">
              <CardDescription className="text-xs font-medium text-muted-foreground">
                Kepala Keluarga
              </CardDescription>
              <CardAction>
                <div className="flex size-8 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground">
                  <HomeIcon className="size-[var(--size-icon-md)]" />
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                {kpis.activeHouseholdsCount}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Total KK: {kpis.totalHouseholdsCount} unit
                </span>
                <Badge variant="success" size="sm">
                  KK Aktif
                </Badge>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/bills" className="group block">
          <Card
            size="sm"
            className="h-full transition-colors duration-150 group-hover:border-border-strong"
          >
            <CardHeader className="pb-0">
              <CardDescription className="text-xs font-medium text-muted-foreground">
                Tagihan Aktif
              </CardDescription>
              <CardAction>
                <div className="flex size-8 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground">
                  <ReceiptIcon className="size-[var(--size-icon-md)]" />
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                {kpis.activeBillsCount}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
                  Piutang: {formatIdr(kpis.totalOutstandingAmount)}
                </span>
                <Badge
                  variant={kpis.overdueBillsCount > 0 ? "destructive" : "outline"}
                  size="sm"
                >
                  {kpis.overdueBillsCount} Jatuh Tempo
                </Badge>
              </div>
            </CardContent>
          </Card>
        </Link>

        {(() => {
          const verifiedPaymentsCard = (
            <Card
              size="sm"
              className="h-full transition-colors duration-150 group-hover:border-border-strong"
            >
              <CardHeader className="pb-0">
                <CardDescription className="text-xs font-medium text-muted-foreground">
                  Pembayaran Terverifikasi (Periode)
                </CardDescription>
                <CardAction>
                  <div className="flex size-8 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground">
                    <WalletIcon className="size-[var(--size-icon-md)]" />
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                <div className="text-xl font-semibold tracking-tight text-foreground tabular-nums sm:text-2xl">
                  {formatIdr(kpis.verifiedPaymentsNetAmount)}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {kpis.verifiedPaymentsCount} transaksi terverifikasi
                  </span>
                  {kpis.pendingVerificationPaymentsCount > 0 && (
                    <Badge variant="warning" size="sm">
                      {kpis.pendingVerificationPaymentsCount} Antre
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )

          return canManageBills ? (
            <Link href="/payments" className="group block">
              {verifiedPaymentsCard}
            </Link>
          ) : (
            <div className="block">{verifiedPaymentsCard}</div>
          )
        })()}

        <Link href="/cash" className="group block sm:col-span-2">
          <Card
            size="sm"
            className="h-full transition-colors duration-150 group-hover:border-border-strong"
          >
            <CardHeader className="pb-0">
              <CardDescription className="text-xs font-medium text-muted-foreground">
                Saldo Kas Ledger (Kumulatif RT)
              </CardDescription>
              <CardAction>
                <div className="flex size-8 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground">
                  <PiggyBankIcon className="size-[var(--size-icon-md)]" />
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div
                className={cn(
                  "text-2xl font-semibold tracking-tight tabular-nums",
                  kpis.cashBalance < 0 ? "text-destructive" : "text-foreground"
                )}
              >
                {formatIdr(kpis.cashBalance)}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                <span>
                  Periode terpilih: Masuk {formatIdr(kpis.periodIncome)} • Keluar{" "}
                  {formatIdr(kpis.periodExpense)}
                </span>
                <Badge
                  variant={kpis.periodNet >= 0 ? "success" : "warning"}
                  size="sm"
                >
                  Neto {formatIdr(kpis.periodNet)}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card size="sm">
          <CardHeader className="pb-0">
            <CardDescription className="text-xs font-medium text-muted-foreground">
              Pengaduan Belum Selesai
            </CardDescription>
            <CardAction>
              <div className="flex size-8 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground">
                <MessageSquareWarningIcon className="size-[var(--size-icon-md)]" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {kpis.unfinishedComplaintsCount}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {kpis.openComplaintsCount} menunggu •{" "}
                {kpis.inProgressComplaintsCount} diproses
              </span>
              <Badge
                variant={
                  kpis.unfinishedComplaintsCount > 0 ? "warning" : "success"
                }
                size="sm"
              >
                Layanan
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="pb-0">
            <CardDescription className="text-xs font-medium text-muted-foreground">
              Permohonan Surat Menunggu
            </CardDescription>
            <CardAction>
              <div className="flex size-8 items-center justify-center rounded-md bg-surface-subtle text-muted-foreground">
                <FileTextIcon className="size-[var(--size-icon-md)]" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
              {kpis.pendingLettersCount}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {kpis.submittedLettersCount} diajukan •{" "}
                {kpis.reviewingLettersCount} ditinjau
              </span>
              <Badge
                variant={kpis.pendingLettersCount > 0 ? "info" : "outline"}
                size="sm"
              >
                Administrasi
              </Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Primary Charts Row: Cash Flow + Activity Feed */}
      <section className="grid gap-[var(--space-6)] xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Tren Pemasukan &amp; Pengeluaran Kas</CardTitle>
            <CardDescription>
              Perbandingan kas masuk dan pengeluaran RT pada {data.period.label}
            </CardDescription>
            <CardAction>
              <Button
                nativeButton={false}
                variant="ghost"
                size="xs"
                render={<Link href="/cash" />}
              >
                Buku Kas
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <FinancialOverviewChart
              data={data.cashTrend}
              isLoading={isBusy && !analyticsQuery.data}
            />
          </CardContent>
        </Card>

        {/* Paginated & Filterable Activity Feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ActivityIcon className="size-[var(--size-icon-md)] text-muted-foreground" />
              <span>Aktivitas Terbaru</span>
            </CardTitle>
            <CardDescription>
              Pembaruan pembayaran, pengaduan, surat, dan pengumuman RT
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-3)]">
            <div className="flex flex-wrap gap-1">
              {ACTIVITY_TABS.map((tab) => {
                const active = appliedParams.activityCategory === tab.value
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() =>
                      setAppliedParams((prev) => ({
                        ...prev,
                        activityCategory: tab.value,
                        activityPage: 1,
                      }))
                    }
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      active
                        ? "bg-primary-subtle text-primary"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {data.activityFeed.items.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
                <InboxIcon className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Belum ada aktivitas
                </p>
                <p className="text-xs text-muted-foreground">
                  Aktivitas operasional pada kategori ini akan muncul otomatis.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {data.activityFeed.items.map((item) => {
                  const content = (
                    <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-background/60 p-2.5 transition-colors hover:bg-surface-subtle/70">
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 text-xs font-medium text-foreground">
                          {item.title}
                        </span>
                        <Badge variant={item.statusVariant} size="sm">
                          {item.statusLabel}
                        </Badge>
                      </div>
                      <p className="line-clamp-1 text-[11px] text-muted-foreground">
                        {item.detail}
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {formatJakartaDateTime(item.timestamp)}
                      </span>
                    </div>
                  )

                  const targetHref =
                    item.href &&
                    (canManageBills || !item.href.startsWith("/payments"))
                      ? item.href
                      : null

                  return targetHref ? (
                    <Link key={item.id} href={targetHref}>
                      {content}
                    </Link>
                  ) : (
                    <div key={item.id}>{content}</div>
                  )
                })}
              </div>
            )}

            {data.activityFeed.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border-subtle pt-2 text-xs text-muted-foreground">
                <span>
                  Hal {data.activityFeed.page} dari{" "}
                  {data.activityFeed.totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={data.activityFeed.page <= 1 || isBusy}
                    onClick={() =>
                      setAppliedParams((prev) => ({
                        ...prev,
                        activityPage: Math.max(1, prev.activityPage - 1),
                      }))
                    }
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={
                      data.activityFeed.page >= data.activityFeed.totalPages ||
                      isBusy
                    }
                    onClick={() =>
                      setAppliedParams((prev) => ({
                        ...prev,
                        activityPage: prev.activityPage + 1,
                      }))
                    }
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Secondary Charts Row: Payment Trend, Complaint Trend, Letter Distribution */}
      <section className="grid gap-[var(--space-6)] md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tren Pembayaran Iuran</CardTitle>
            <CardDescription>
              Pembayaran iuran terverifikasi neto per periode
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentTrendChart
              data={data.paymentTrend}
              isLoading={isBusy && !analyticsQuery.data}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tren Pengaduan Warga</CardTitle>
            <CardDescription>
              Perbandingan pengaduan aktif vs selesai per periode
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ComplaintTrendChart
              data={data.complaintTrend}
              isLoading={isBusy && !analyticsQuery.data}
            />
          </CardContent>
        </Card>

        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">
              Distribusi Status Permohonan Surat
            </CardTitle>
            <CardDescription>
              Sebaran status pengajuan surat pada periode terpilih
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LetterDistributionChart
              data={data.letterDistribution}
              totalInPeriod={data.totalLettersInPeriod}
              isLoading={isBusy && !analyticsQuery.data}
            />
          </CardContent>
        </Card>
      </section>

      {/* Latest Payments Table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>Pembayaran Iuran Terbaru</CardTitle>
            <CardDescription>
              Transaksi pembayaran warga terbaru pada {data.tenantName}
            </CardDescription>
          </div>
          {canManageBills && (
            <div className="shrink-0">
              <Button
                nativeButton={false}
                variant="outline"
                size="xs"
                render={<Link href="/payments" />}
              >
                Verifikasi Pembayaran
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="px-0">
          {data.recentPayments.length === 0 ? (
            <div className="mx-[var(--space-6)] flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
              <ReceiptIcon className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                Belum ada catatan pembayaran
              </p>
              <p className="text-xs text-muted-foreground">
                Pembayaran iuran warga akan muncul di tabel ini setelah dikirim.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-[var(--space-6)]">
                        Warga / KK
                      </TableHead>
                      <TableHead>Iuran &amp; Periode</TableHead>
                      <TableHead>Metode</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-[var(--space-6)] text-right">
                        Nominal
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentPayments.map((pay) => (
                      <TableRow key={pay.id}>
                        <TableCell className="pl-[var(--space-6)] font-medium text-foreground">
                          <Link
                            href={
                              canManageBills
                                ? `/payments/${pay.id}`
                                : `/bills/${pay.billId}`
                            }
                            className="hover:text-primary hover:underline"
                          >
                            {pay.targetLabel}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {pay.dueName} •{" "}
                          {formatBillPeriod(pay.periodYear, pay.periodMonth)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {PAYMENT_METHOD_LABELS[pay.paymentMethod]}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatJakartaDate(pay.verifiedAt ?? pay.paidAt)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={getPaymentStatusBadgeVariant(pay.status)}
                            size="sm"
                          >
                            {PAYMENT_STATUS_LABELS[pay.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="pr-[var(--space-6)] text-right font-medium tabular-nums text-foreground">
                          {formatIdr(pay.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-2.5 px-[var(--space-4)] sm:px-[var(--space-6)] md:hidden">
                {data.recentPayments.map((pay) => (
                  <Link
                    key={pay.id}
                    href={
                      canManageBills
                        ? `/payments/${pay.id}`
                        : `/bills/${pay.billId}`
                    }
                    className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-background/60 p-3 transition-colors hover:bg-surface-subtle/70"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {pay.targetLabel}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {pay.dueName} •{" "}
                          {formatBillPeriod(pay.periodYear, pay.periodMonth)}
                        </p>
                      </div>
                      <Badge
                        variant={getPaymentStatusBadgeVariant(pay.status)}
                        size="sm"
                      >
                        {PAYMENT_STATUS_LABELS[pay.status]}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2 text-xs">
                      <span className="text-muted-foreground">
                        {PAYMENT_METHOD_LABELS[pay.paymentMethod]} •{" "}
                        {formatJakartaDate(pay.verifiedAt ?? pay.paidAt)}
                      </span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatIdr(pay.amount)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent Complaints + Recent Letter Requests */}
      <section className="grid gap-[var(--space-6)] lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareWarningIcon className="size-[var(--size-icon-md)] text-muted-foreground" />
              <span>Pengaduan Terbaru</span>
            </CardTitle>
            <CardDescription>
              Laporan kendala atau masukan terbaru dari warga
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {data.recentComplaints.length === 0 ? (
              <div className="flex h-36 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
                <InboxIcon className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Belum ada pengaduan warga
                </p>
              </div>
            ) : (
              data.recentComplaints.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-background/60 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {c.title}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={getComplaintPriorityBadgeVariant(c.priority)}
                        size="sm"
                      >
                        {COMPLAINT_PRIORITY_LABELS[c.priority]}
                      </Badge>
                      <Badge
                        variant={getComplaintStatusBadgeVariant(c.status)}
                        size="sm"
                      >
                        {COMPLAINT_STATUS_LABELS[c.status]}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {c.reporterLabel} • {c.category}
                    </span>
                    <span>{formatJakartaDate(c.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileTextIcon className="size-[var(--size-icon-md)] text-muted-foreground" />
              <span>Permohonan Surat Terbaru</span>
            </CardTitle>
            <CardDescription>
              Pengajuan surat pengantar dan administrasi warga
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {data.recentLetters.length === 0 ? (
              <div className="flex h-36 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
                <InboxIcon className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Belum ada permohonan surat
                </p>
              </div>
            ) : (
              data.recentLetters.map((lr) => (
                <div
                  key={lr.id}
                  className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-background/60 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {lr.letterTypeName}
                    </span>
                    <Badge
                      variant={getLetterStatusBadgeVariant(lr.status)}
                      size="sm"
                    >
                      {LETTER_STATUS_LABELS[lr.status]}
                    </Badge>
                  </div>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {lr.residentName} • {lr.purpose}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {lr.letterNumber ? `No. ${lr.letterNumber}` : "Belum bernomor"}
                    </span>
                    <span>{formatJakartaDate(lr.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* Active Bills + Quick Role Actions */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <WalletIcon className="size-[var(--size-icon-md)] text-muted-foreground" />
              <span>Ringkasan Iuran &amp; Tagihan RT</span>
            </CardTitle>
            <CardDescription>
              Tagihan iuran aktif terdekat dan pintasan pengelolaan pada {data.tenantName}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
            {canManageResidents && (
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link href="/residents/new" />}
              >
                Tambah Warga
              </Button>
            )}
            {canManageBills ? (
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link href="/bills/new" />}
              >
                Terbitkan Tagihan
              </Button>
            ) : canManageDues ? (
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link href="/dues/new" />}
              >
                Buat Iuran
              </Button>
            ) : null}
            <Button
              nativeButton={false}
              variant="ghost"
              size="sm"
              render={<Link href="/dues" />}
            >
              Konfigurasi Iuran
            </Button>
            <Button
              nativeButton={false}
              variant="ghost"
              size="sm"
              render={<Link href="/bills" />}
            >
              Tagihan Warga
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentBills.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 py-6 text-center">
              <InboxIcon className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                Tidak ada tagihan aktif
              </p>
            </div>
          ) : (
            <div className="grid gap-[var(--space-2)] md:grid-cols-2">
              {data.recentBills.map((bill) => (
                <Link
                  key={bill.id}
                  href={`/bills/${bill.id}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border-subtle bg-background/60 p-3 transition-colors hover:bg-surface-subtle/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {bill.targetLabel}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {bill.dueName} •{" "}
                      {formatBillPeriod(bill.periodYear, bill.periodMonth)} •
                      Tempo {formatJakartaDate(bill.dueDate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {formatIdr(bill.remainingAmount)}
                    </span>
                    <Badge
                      variant={getBillStatusBadgeVariant(bill.status)}
                      size="sm"
                    >
                      {BILL_STATUS_LABELS[bill.status]}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Announcements */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <MegaphoneIcon className="size-[var(--size-icon-md)] text-muted-foreground" />
              <span>Pengumuman Terbaru RT</span>
            </CardTitle>
            <CardDescription>
              Pengumuman aktif &amp; draf dari database {data.tenantName}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            {canManageAnnouncements && (
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link href="/announcements/new" />}
              >
                Buat Baru
              </Button>
            )}
            <Button
              nativeButton={false}
              variant="ghost"
              size="sm"
              render={<Link href="/announcements" />}
            >
              Kelola Semua
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentAnnouncements.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 py-8 text-center">
              <InboxIcon className="size-7 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                Belum ada pengumuman
              </p>
              <p className="text-xs text-muted-foreground">
                Pengumuman RT yang dibuat oleh pengurus akan tampil di sini.
              </p>
            </div>
          ) : (
            <div className="grid gap-[var(--space-3)] md:grid-cols-2">
              {data.recentAnnouncements.map((ann) => (
                <Link
                  key={ann.id}
                  href={`/announcements/${ann.id}`}
                  className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-background/60 p-3.5 transition-colors hover:bg-surface-subtle/70"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={getAnnouncementStatusBadgeVariant(ann.status)}
                        size="sm"
                      >
                        {ANNOUNCEMENT_STATUS_LABELS[ann.status]}
                      </Badge>
                      <Badge variant="outline" size="sm">
                        {ANNOUNCEMENT_TARGET_LABELS[ann.targetType]}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {formatJakartaDate(ann.publishedAt ?? ann.updatedAt)}
                    </span>
                  </div>
                  <p className="line-clamp-1 text-sm font-semibold text-foreground">
                    {ann.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {ann.content}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}

