"use client"

import Link from "next/link"
import {
  BellIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  HomeIcon,
  InboxIcon,
  MapPinIcon,
  MegaphoneIcon,
  MessageSquareWarningIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"

import { ResidentContainer } from "@/components/resident/resident-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  ACTIVITY_STATUS_LABELS,
  COMPLAINT_STATUS_LABELS,
  getComplaintStatusBadgeVariant,
  getLetterStatusBadgeVariant,
  LETTER_STATUS_LABELS,
  type ResidentDashboardData,
} from "@/lib/analytics/types"
import {
  getAnnouncementTargetBadgeVariant,
  RESIDENT_SAFE_TARGET_LABELS,
} from "@/lib/announcements/types"
import {
  BILL_STATUS_LABELS,
  formatBillPeriod,
  formatIdr,
  formatJakartaDate,
  formatJakartaDateTime,
  getBillStatusBadgeVariant,
  getPaymentStatusBadgeVariant,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/finance/types"
import {
  getNotificationTypeLabel,
} from "@/lib/notifications/types"
import {
  getResidencyStatusBadgeVariant,
  RESIDENCY_STATUS_LABELS,
} from "@/lib/residents/types"

const QUICK_ACTIONS = [
  {
    label: "Tagihan Iuran",
    description: "Cek & bayar iuran",
    href: "/resident/bills",
    icon: WalletIcon,
  },
  {
    label: "Pengumuman",
    description: "Informasi resmi RT",
    href: "/resident/announcements",
    icon: MegaphoneIcon,
  },
  {
    label: "Notifikasi",
    description: "Pembaruan akun Anda",
    href: "/resident/notifications",
    icon: BellIcon,
  },
  {
    label: "Pengaduan Warga",
    description: "Laporkan keluhan & saran",
    href: "/resident/complaints",
    icon: MessageSquareWarningIcon,
  },
  {
    label: "Jadwal Ronda",
    description: "Roster & tugas malam",
    href: "/resident/ronda",
    icon: ShieldCheckIcon,
  },
  {
    label: "Kartu Keluarga",
    description: "Profil & anggota KK",
    href: "/resident/household",
    icon: UsersIcon,
  },
]

interface ResidentDashboardViewProps {
  data: ResidentDashboardData
  fallbackGreetingName: string
}

export function ResidentDashboardView({
  data,
  fallbackGreetingName,
}: ResidentDashboardViewProps) {
  const {
    tenantName,
    tenantSubtitle,
    linked,
    residentProfile,
    financeSummary,
    paymentSummary,
    complaintsSummary,
    lettersSummary,
    unreadNotifications,
    recentAnnouncements,
    upcomingActivities,
  } = data

  const displayName = residentProfile?.fullName ?? fallbackGreetingName

  return (
    <ResidentContainer>
      {/* Greeting Header */}
      <section className="flex flex-col justify-between gap-[var(--space-2)] sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {tenantName} • {tenantSubtitle}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Selamat Datang, {displayName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pantau tagihan pribadi, status pembayaran, pengumuman, layanan, dan
            notifikasi Anda.
          </p>
        </div>

        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          render={<Link href="/resident/notifications" />}
          className="w-fit gap-2"
        >
          <BellIcon className="size-4" />
          <span>Notifikasi Belum Dibaca</span>
          <Badge
            variant={unreadNotifications.unreadCount > 0 ? "info" : "outline"}
            size="sm"
          >
            {unreadNotifications.unreadCount}
          </Badge>
        </Button>
      </section>

      {/* Resident Info Summary + Monthly Dues Status */}
      <section className="grid gap-[var(--space-4)] md:grid-cols-5">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Informasi Hunian Anda</CardTitle>
            <CardDescription>Data kependudukan terdaftar di RT</CardDescription>
            <CardAction>
              {linked && residentProfile && (
                <Badge
                  variant={getResidencyStatusBadgeVariant(
                    residentProfile.residencyStatus
                  )}
                  size="sm"
                >
                  {RESIDENCY_STATUS_LABELS[residentProfile.residencyStatus]}
                </Badge>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-3)]">
            {!linked || !residentProfile ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 p-4 text-center">
                <HomeIcon className="size-6 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">
                  Profil warga belum terhubung ke data Kartu Keluarga
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Hubungi pengurus RT untuk menautkan akun dengan data warga.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-[var(--space-2-5)] text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-[var(--space-2)] text-muted-foreground">
                    <HomeIcon className="size-[var(--size-icon-sm)]" />
                    Unit / Blok
                  </span>
                  <span className="truncate font-medium text-foreground">
                    {residentProfile.unitLabel}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Wilayah</span>
                  <span className="font-medium text-foreground">
                    {tenantSubtitle}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-[var(--space-2)] text-muted-foreground">
                    <UsersIcon className="size-[var(--size-icon-sm)]" />
                    Anggota KK
                  </span>
                  <span className="font-medium text-foreground tabular-nums">
                    {residentProfile.familyMembersCount} Orang
                  </span>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              nativeButton={false}
              variant="ghost"
              size="xs"
              render={<Link href="/resident/profile" />}
            >
              Profil Pribadi
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>

        {/* Personal Bills Summary */}
        <Card className="min-w-0 md:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Status Tagihan Iuran</CardTitle>
            <CardDescription>
              {financeSummary.outstandingCount > 0
                ? `${financeSummary.outstandingCount} tagihan aktif${
                    financeSummary.pendingVerificationCount > 0
                      ? ` • ${financeSummary.pendingVerificationCount} menunggu verifikasi`
                      : ""
                  }${
                    financeSummary.overdueCount > 0
                      ? ` • ${financeSummary.overdueCount} jatuh tempo`
                      : ""
                  }`
                : "Kewajiban iuran pribadi dan Kartu Keluarga Anda"}
            </CardDescription>
            <CardAction>
              <Badge
                variant={
                  financeSummary.overdueCount > 0
                    ? "destructive"
                    : financeSummary.outstandingCount > 0
                      ? "warning"
                      : "success"
                }
                size="sm"
              >
                {financeSummary.overdueCount > 0
                  ? `${financeSummary.overdueCount} Terlambat`
                  : financeSummary.outstandingCount > 0
                    ? `${financeSummary.outstandingCount} Aktif`
                    : "Lunas"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-3)]">
            {financeSummary.upcomingBills.length === 0 &&
            financeSummary.outstandingCount === 0 ? (
              <div className="flex flex-col items-center justify-center gap-[var(--space-1-5)] rounded-lg border border-dashed border-border bg-surface-subtle/40 p-[var(--space-4)] text-center">
                <WalletIcon className="size-[var(--size-icon-lg)] text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Tidak ada tagihan aktif
                </p>
                <p className="text-xs text-muted-foreground">
                  Seluruh tagihan iuran Anda saat ini lunas atau belum
                  diterbitkan.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Total Sisa Tagihan
                    </p>
                    <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-3xl">
                      {formatIdr(financeSummary.totalOutstandingAmount)}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {paymentSummary.paidBillsCount} dari{" "}
                    {paymentSummary.totalBillsCount} tagihan lunas
                  </span>
                </div>
                <div className="grid gap-[var(--space-1-5)] rounded-lg bg-surface-subtle/70 p-[var(--space-3)] text-xs">
                  {financeSummary.upcomingBills.map((bill) => (
                    <Link
                      key={bill.id}
                      href={`/resident/bills/${bill.id}`}
                      className="flex min-w-0 flex-col justify-between gap-1.5 rounded-md py-1 transition-colors hover:text-foreground sm:flex-row sm:items-center sm:gap-2"
                    >
                      <span className="min-w-0 truncate text-muted-foreground">
                        {bill.dueName} (
                        {formatBillPeriod(bill.periodYear, bill.periodMonth)}) •
                        Tempo {formatJakartaDate(bill.dueDate)}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 font-medium text-foreground tabular-nums">
                        {formatIdr(bill.remainingAmount)}
                        <Badge
                          variant={getBillStatusBadgeVariant(bill.status)}
                          size="sm"
                        >
                          {BILL_STATUS_LABELS[bill.status]}
                        </Badge>
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="justify-between gap-[var(--space-3)]">
            <span className="text-xs text-muted-foreground">
              Terisolasi hanya untuk tagihan milik Anda/KK Anda
            </span>
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link href="/resident/bills" />}
            >
              Lihat Semua Tagihan
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      </section>

      {/* Quick Actions */}
      <section
        aria-label="Aksi Cepat Warga"
        className="flex flex-col gap-[var(--space-3)]"
      >
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Aksi Cepat
        </h2>
        <div className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-3 lg:grid-cols-5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.label}
                href={action.href}
                className="group flex min-h-[88px] flex-col justify-between rounded-xl border border-border bg-surface p-[var(--space-4)] shadow-xs transition-all duration-150 outline-none hover:border-primary-border hover:bg-primary-subtle/30 focus-visible:ring-3 focus-visible:ring-ring/25 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-md bg-primary-subtle text-primary transition-colors duration-150 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="size-[var(--size-icon-lg)]" />
                  </span>
                  <ChevronRightIcon className="size-[var(--size-icon-md)] text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <div className="mt-[var(--space-3)]">
                  <div className="text-sm font-semibold text-foreground">
                    {action.label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {action.description}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Personal Payment Status + Unread Notifications */}
      <section className="grid gap-[var(--space-4)] md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptIcon className="size-4 text-muted-foreground" />
              <span>Status Pembayaran Pribadi</span>
            </CardTitle>
            <CardDescription>
              Riwayat pembayaran iuran Anda &amp; status verifikasi bendahara
            </CardDescription>
            <CardAction>
              <Button
                nativeButton={false}
                variant="ghost"
                size="sm"
                render={<Link href="/resident/bills" />}
              >
                Tagihan
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="col-span-2 rounded-lg border border-border-subtle bg-surface-subtle/50 p-2.5 sm:col-span-1">
                <p className="text-[11px] text-muted-foreground">Terverifikasi</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {formatIdr(paymentSummary.verifiedTotalAmount)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {paymentSummary.verifiedCount} transaksi
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-subtle/50 p-2.5">
                <p className="text-[11px] text-muted-foreground">Menunggu</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {paymentSummary.pendingCount}
                </p>
                <p className="text-[10px] text-muted-foreground">Verifikasi</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-subtle/50 p-2.5">
                <p className="text-[11px] text-muted-foreground">Ditolak</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {paymentSummary.rejectedCount}
                </p>
                <p className="text-[10px] text-muted-foreground">Perlu ulang</p>
              </div>
            </div>

            {paymentSummary.recentPayments.length === 0 ? (
              <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
                <p className="text-xs font-medium text-foreground">
                  Belum ada riwayat pembayaran pribadi
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {paymentSummary.recentPayments.map((pay) => (
                  <Link
                    key={pay.id}
                    href={`/resident/bills/${pay.billId}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-background/60 p-2.5 text-xs transition-colors hover:bg-surface-subtle/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {pay.dueName} •{" "}
                        {formatBillPeriod(pay.periodYear, pay.periodMonth)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {PAYMENT_METHOD_LABELS[pay.paymentMethod]} •{" "}
                        {formatJakartaDate(pay.verifiedAt ?? pay.paidAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatIdr(pay.amount)}
                      </span>
                      <Badge
                        variant={getPaymentStatusBadgeVariant(pay.status)}
                        size="sm"
                      >
                        {PAYMENT_STATUS_LABELS[pay.status]}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellIcon className="size-4 text-muted-foreground" />
              <span>Notifikasi Belum Dibaca</span>
            </CardTitle>
            <CardDescription>
              Pembaruan terbaru khusus akun Anda ({unreadNotifications.unreadCount}{" "}
              belum dibaca)
            </CardDescription>
            <CardAction>
              <Button
                nativeButton={false}
                variant="ghost"
                size="sm"
                render={<Link href="/resident/notifications" />}
              >
                Semua
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {unreadNotifications.recent.length === 0 ? (
              <div className="flex h-44 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
                <BellIcon className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Semua notifikasi sudah dibaca
                </p>
                <p className="text-xs text-muted-foreground">
                  Pemberitahuan tagihan, pembayaran, dan info RT akan tampil di
                  sini.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {unreadNotifications.recent.map((notif) => (
                  <Link
                    key={notif.id}
                    href={`/resident/notifications?selected=${notif.id}`}
                    className="flex flex-col gap-1 rounded-lg border border-primary/25 bg-primary-subtle/20 p-3 transition-colors hover:bg-primary-subtle/35"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="info" size="sm">
                        {getNotificationTypeLabel(notif.type)}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatJakartaDateTime(notif.createdAt)}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-sm font-medium text-foreground">
                      {notif.title}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {notif.body}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Personal Complaints + Personal Letter Requests */}
      <section className="grid gap-[var(--space-4)] md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareWarningIcon className="size-4 text-muted-foreground" />
              <span>Status Pengaduan Pribadi</span>
            </CardTitle>
            <CardDescription>
              Pengaduan yang Anda kirimkan ({complaintsSummary.totalCount}{" "}
              total)
            </CardDescription>
            <CardAction>
              <Button
                nativeButton={false}
                variant="ghost"
                size="sm"
                render={<Link href="/resident/complaints" />}
              >
                Semua
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Menunggu</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {complaintsSummary.openCount}
                </p>
              </div>
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Diproses</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {complaintsSummary.inProgressCount}
                </p>
              </div>
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Selesai</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {complaintsSummary.resolvedCount}
                </p>
              </div>
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Ditolak</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {complaintsSummary.rejectedCount}
                </p>
              </div>
            </div>

            {complaintsSummary.recent.length === 0 ? (
              <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
                <p className="text-xs font-medium text-foreground">
                  Belum ada pengaduan yang dikirim
                </p>
                <Button
                  nativeButton={false}
                  variant="outline"
                  size="xs"
                  render={<Link href="/resident/complaints/new" />}
                >
                  Buat Pengaduan
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {complaintsSummary.recent.map((cmp) => (
                  <Link
                    key={cmp.id}
                    href={`/resident/complaints/${cmp.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-background/60 p-2.5 text-xs transition-colors hover:bg-surface-subtle/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {cmp.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {cmp.category} • {formatJakartaDate(cmp.createdAt)}
                      </p>
                    </div>
                    <Badge
                      variant={getComplaintStatusBadgeVariant(cmp.status)}
                      size="sm"
                    >
                      {COMPLAINT_STATUS_LABELS[cmp.status]}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileTextIcon className="size-4 text-muted-foreground" />
              <span>Status Permohonan Surat Pribadi</span>
            </CardTitle>
            <CardDescription>
              Pengajuan surat pengantar milik Anda ({lettersSummary.totalCount}{" "}
              total)
            </CardDescription>
            <CardAction>
              <Button
                nativeButton={false}
                variant="ghost"
                size="sm"
                render={<Link href="/resident/letters" />}
              >
                Kelola
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Diajukan</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {lettersSummary.submittedCount}
                </p>
              </div>
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Ditinjau</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {lettersSummary.reviewingCount}
                </p>
              </div>
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Selesai</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {lettersSummary.approvedCount + lettersSummary.completedCount}
                </p>
              </div>
              <div className="rounded-lg bg-surface-subtle/70 p-2">
                <p className="text-[11px] text-muted-foreground">Ditolak</p>
                <p className="text-sm font-semibold tabular-nums text-foreground">
                  {lettersSummary.rejectedCount}
                </p>
              </div>
            </div>

            {lettersSummary.recent.length === 0 ? (
              <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
                <p className="text-xs font-medium text-foreground">
                  Belum ada permohonan surat pribadi
                </p>
                <Button
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                  render={<Link href="/resident/letters/new" />}
                >
                  Ajukan Surat
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {lettersSummary.recent.map((ltr) => (
                  <Link
                    key={ltr.id}
                    href={`/resident/letters/${ltr.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-background/60 p-2.5 text-xs transition-colors hover:border-primary/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {ltr.letterTypeName}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {ltr.purpose} • {formatJakartaDate(ltr.createdAt)}
                      </p>
                    </div>
                    <Badge
                      variant={getLetterStatusBadgeVariant(ltr.status)}
                      size="sm"
                    >
                      {LETTER_STATUS_LABELS[ltr.status]}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Latest Announcements + Community Activities */}
      <section className="grid gap-[var(--space-4)] md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pengumuman Terbaru</CardTitle>
            <CardDescription>Informasi resmi pengurus RT</CardDescription>
            <CardAction>
              <Button
                nativeButton={false}
                variant="ghost"
                size="sm"
                render={<Link href="/resident/announcements" />}
              >
                Semua
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-3)]">
            {recentAnnouncements.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-[var(--space-1-5)] rounded-lg border border-dashed border-border bg-surface-subtle/40 p-[var(--space-4)] text-center">
                <InboxIcon className="size-[var(--size-icon-lg)] text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Belum ada pengumuman
                </p>
                <p className="text-xs text-muted-foreground">
                  Pengumuman terbaru dari pengurus RT akan muncul di sini.
                </p>
              </div>
            ) : (
              recentAnnouncements.map((ann) => (
                <Link
                  key={ann.id}
                  href={`/resident/announcements/${ann.id}`}
                  className="flex flex-col gap-[var(--space-1-5)] rounded-lg border border-border-subtle bg-background/60 p-[var(--space-3)] transition-colors duration-150 hover:bg-surface-subtle/70"
                >
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <Badge
                      variant={getAnnouncementTargetBadgeVariant(ann.targetType)}
                      size="sm"
                    >
                      {RESIDENT_SAFE_TARGET_LABELS[ann.targetType]}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {formatJakartaDate(ann.publishedAt ?? ann.createdAt)}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-foreground">
                    {ann.title}
                  </h3>
                  <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {ann.content}
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kegiatan Lingkungan</CardTitle>
            <CardDescription>
              Agenda warga terjadwal di {tenantName}
            </CardDescription>
            <CardAction>
              <CalendarDaysIcon className="size-[var(--size-icon-md)] text-muted-foreground" />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-3)]">
            {upcomingActivities.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-[var(--space-1-5)] rounded-lg border border-dashed border-border bg-surface-subtle/40 p-[var(--space-4)] text-center">
                <CalendarDaysIcon className="size-[var(--size-icon-lg)] text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  Belum ada kegiatan terjadwal
                </p>
                <p className="text-xs text-muted-foreground">
                  Jadwal kerja bakti atau rapat warga akan tampil di sini.
                </p>
              </div>
            ) : (
              upcomingActivities.map((act) => (
                <Link
                  key={act.id}
                  href={`/resident/activities/${act.id}`}
                  className="group flex flex-col gap-[var(--space-1)] rounded-lg border border-border-subtle bg-background/60 p-[var(--space-3)] transition-colors hover:border-primary/40 hover:bg-surface"
                >
                  <div className="flex items-center justify-between gap-[var(--space-2)]">
                    <span className="text-sm font-medium text-foreground group-hover:text-primary">
                      {act.title}
                    </span>
                    <Badge variant="accent" size="sm">
                      {ACTIVITY_STATUS_LABELS[act.status]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-1 text-xs text-muted-foreground">
                    <span>{formatJakartaDateTime(act.startAt)}</span>
                    <span className="inline-flex items-center gap-1">
                      <MapPinIcon className="size-[var(--size-icon-xs)]" />
                      {act.location}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-2 pt-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-primary"
              nativeButton={false}
              render={<Link href="/resident/activities/my" />}
            >
              <span>Kegiatan Saya</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary"
              nativeButton={false}
              render={<Link href="/resident/activities" />}
            >
              <span>Lihat semua kegiatan</span>
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </CardFooter>
        </Card>
      </section>
    </ResidentContainer>
  )
}

