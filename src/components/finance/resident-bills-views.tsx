"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  ExternalLinkIcon,
  FileUpIcon,
  WalletIcon,
} from "lucide-react"

import {
  retryPaymentProofAction,
  submitResidentPaymentAction,
} from "@/app/actions/finance"
import { ResidentContainer } from "@/components/resident/resident-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  BILL_STATUS_LABELS,
  DUES_BILLING_CYCLE_LABELS,
  DUES_TARGET_SCOPE_LABELS,
  formatBillPeriod,
  formatIdr,
  formatJakartaDate,
  formatJakartaDateTime,
  getBillStatusBadgeVariant,
  getJakartaTodayIsoDate,
  getPaymentStatusBadgeVariant,
  isBillEffectivelyOverdue,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  RESIDENT_PAYMENT_METHOD_LABELS,
  type BillPaymentSummary,
  type BillSummary,
  type FinanceFormActionState,
} from "@/lib/finance/types"

interface ResidentBillsListViewProps {
  tenantName: string
  items: BillSummary[]
  outstandingCount: number
  overdueCount: number
  totalOutstandingAmount: number
  error: string | null
}

export function ResidentBillsListView({
  tenantName,
  items,
  outstandingCount,
  overdueCount,
  totalOutstandingAmount,
  error,
}: ResidentBillsListViewProps) {
  const router = useRouter()
  const todayIso = getJakartaTodayIsoDate()

  return (
    <ResidentContainer>
      <section className="flex flex-col justify-between gap-[var(--space-3)] sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Tagihan &amp; Iuran Saya
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daftar tagihan iuran resmi {tenantName} untuk Anda dan keluarga
            Anda.
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          render={<Link href="/resident" />}
        >
          <ArrowLeftIcon className="size-4" />
          <span>Beranda</span>
        </Button>
      </section>

      <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">
              Total Kewajiban Aktif
            </CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums">
              {formatIdr(totalOutstandingAmount)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">
              Tagihan Belum Lunas
            </CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums">
              {outstandingCount} Tagihan
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">
              Melewati Jatuh Tempo
            </CardDescription>
            <CardTitle
              className={`text-xl font-semibold tabular-nums ${overdueCount > 0 ? "text-destructive" : "text-foreground"}`}
            >
              {overdueCount} Tagihan
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircleIcon className="size-8 text-destructive" />
            <p className="text-sm font-medium text-foreground">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.refresh()}
            >
              Muat Ulang
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <WalletIcon className="size-10 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                Belum ada tagihan untuk Anda
              </p>
              <p className="text-xs text-muted-foreground">
                Tagihan iuran yang diterbitkan oleh Bendahara untuk keluarga atau
                akun Anda akan tampil di halaman ini.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-[var(--space-3)]">
          {items.map((bill) => {
            const effectivelyOverdue = isBillEffectivelyOverdue(
              bill.status,
              bill.dueDate,
              todayIso
            )
            return (
              <Card key={bill.id} data-testid={`resident-bill-${bill.id}`}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={getBillStatusBadgeVariant(bill.status)}
                        size="sm"
                      >
                        {BILL_STATUS_LABELS[bill.status]}
                      </Badge>
                      {effectivelyOverdue && bill.status !== "overdue" && (
                        <Badge variant="destructive" size="sm">
                          Lewat Jatuh Tempo
                        </Badge>
                      )}
                      <Badge variant="outline" size="sm">
                        {DUES_TARGET_SCOPE_LABELS[bill.dueTargetScope]}
                      </Badge>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarIcon className="size-3.5" />
                      Jatuh tempo: {formatJakartaDate(bill.dueDate)}
                    </span>
                  </div>

                  <div className="flex flex-col justify-between gap-2 pt-1 sm:flex-row sm:items-center">
                    <div>
                      <CardTitle className="text-base">
                        <Link
                          href={`/resident/bills/${bill.id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {bill.dueName}
                        </Link>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Periode{" "}
                        {formatBillPeriod(bill.periodYear, bill.periodMonth)} •{" "}
                        {bill.targetLabel}
                      </CardDescription>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-lg font-semibold tabular-nums text-foreground">
                        {formatIdr(bill.remainingAmount)}
                      </p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        Nominal: {formatIdr(bill.amount)} • Terbayar:{" "}
                        {formatIdr(bill.paidAmount)}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                    render={<Link href={`/resident/bills/${bill.id}`} />}
                  >
                    <span>Lihat Rincian</span>
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </ResidentContainer>
  )
}

const INITIAL_PAYMENT_STATE: FinanceFormActionState = { error: null }

interface ResidentBillDetailViewProps {
  tenantName: string
  bill: BillSummary
  payments: BillPaymentSummary[]
  notice?: "submitted" | null
}

export function ResidentBillDetailView({
  tenantName,
  bill,
  payments,
  notice = null,
}: ResidentBillDetailViewProps) {
  const [formState, formAction, isPending] = React.useActionState(
    submitResidentPaymentAction,
    INITIAL_PAYMENT_STATE
  )
  const [recoveryState, recoveryFormAction, isRecovering] = React.useActionState(
    retryPaymentProofAction,
    INITIAL_PAYMENT_STATE
  )
  const formInstanceId = React.useId()
  const idempotencyNonce = `${formInstanceId}-${payments.length}`
  const [selectedFileName, setSelectedFileName] = React.useState<string | null>(
    null
  )
  const [recoveryFileName, setRecoveryFileName] = React.useState<string | null>(
    null
  )

  const todayIso = getJakartaTodayIsoDate()
  const effectivelyOverdue = isBillEffectivelyOverdue(
    bill.status,
    bill.dueDate,
    todayIso
  )

  const pendingPayment = payments.find(
    (p) => p.status === "pending" && p.proofStoragePath !== null
  )
  const recoverablePayment = !pendingPayment
    ? payments.find(
        (p) =>
          p.paymentType === "payment" &&
          p.status === "pending" &&
          p.proofStoragePath === null &&
          !p.isStaleIncomplete
      )
    : undefined
  const latestRejectedPayment = payments.find((p) => p.status === "rejected")
  const isTerminalStatus =
    bill.status === "paid" ||
    bill.status === "cancelled" ||
    bill.status === "refunded"
  const canSubmitPayment =
    !isTerminalStatus &&
    bill.status !== "pending_verification" &&
    !pendingPayment &&
    bill.remainingAmount > 0

  return (
    <ResidentContainer>
      <section className="flex flex-col justify-between gap-[var(--space-3)] sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {bill.dueName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rincian tagihan {tenantName} • Periode{" "}
            {formatBillPeriod(bill.periodYear, bill.periodMonth)}
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          render={<Link href="/resident/bills" />}
        >
          <ArrowLeftIcon className="size-4" />
          <span>Semua Tagihan</span>
        </Button>
      </section>

      {notice === "submitted" && (
        <div
          role="status"
          data-testid="payment-submitted-banner"
          className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-foreground"
        >
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
          <div>
            <p className="font-medium">
              Pembayaran &amp; bukti berhasil dikirim.
            </p>
            <p className="text-xs text-muted-foreground">
              Tagihan kini berstatus Menunggu Verifikasi hingga diperiksa oleh
              Bendahara RT.
            </p>
          </div>
        </div>
      )}

      {pendingPayment && (
        <div
          role="status"
          data-testid="payment-pending-banner"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          <ClockIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">
              Pengajuan pembayaran sedang menunggu verifikasi Bendahara.
            </p>
            <p className="text-xs text-muted-foreground">
              Nominal {formatIdr(pendingPayment.amount)} via{" "}
              {PAYMENT_METHOD_LABELS[pendingPayment.paymentMethod]} dikirim pada{" "}
              {formatJakartaDateTime(pendingPayment.paidAt)}. Anda baru dapat
              mengajukan ulang apabila pembayaran ini ditolak.
            </p>
          </div>
        </div>
      )}

      {!pendingPayment && recoverablePayment && canSubmitPayment && (
        <div
          role="region"
          aria-label="Pemulihan Pengajuan Pembayaran"
          data-testid="incomplete-payment-recovery-card"
          className="flex flex-col gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm text-foreground"
        >
          <div className="flex items-start gap-2">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-semibold">
                Pengajuan pembayaran sebelumnya belum selesai ditautkan.
              </p>
              <p className="text-xs text-muted-foreground">
                Tercatat pengajuan sebesar{" "}
                <span className="font-medium text-foreground">
                  {formatIdr(recoverablePayment.amount)}
                </span>{" "}
                via {PAYMENT_METHOD_LABELS[recoverablePayment.paymentMethod]} pada{" "}
                {formatJakartaDateTime(recoverablePayment.paidAt)}.{" "}
                {recoverablePayment.hasUploadedProofInStorage
                  ? "Berkas bukti sudah tersimpan di penyimpanan privat dan siap ditautkan ulang tanpa mengirim duplikat."
                  : "Unggah bukti pembayaran untuk menyelesaikan pengajuan ini tanpa membuat pengajuan ganda."}
              </p>
            </div>
          </div>

          <form
            action={recoveryFormAction}
            data-testid="recover-payment-form"
            className="flex flex-col gap-3 rounded-md border border-border bg-background/80 p-3"
          >
            <input type="hidden" name="billId" value={bill.id} />
            <input
              type="hidden"
              name="paymentId"
              value={recoverablePayment.id}
            />

            {recoveryState.error && (
              <div
                role="alert"
                data-testid="recover-payment-error"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{recoveryState.error}</span>
              </div>
            )}

            {!recoverablePayment.hasUploadedProofInStorage && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="recovery-proof-input"
                  className="text-xs font-medium text-foreground"
                >
                  Unggah Bukti Pembayaran (JPG, PNG, PDF • Maks. 5 MB)
                </label>
                <input
                  id="recovery-proof-input"
                  name="proof"
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  required
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    setRecoveryFileName(file ? file.name : null)
                  }}
                  className="text-xs text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted"
                />
                {recoveryFileName && (
                  <p className="text-xs text-muted-foreground">
                    Dipilih: {recoveryFileName}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                ID Pengajuan:{" "}
                <code className="text-[11px]">{recoverablePayment.id}</code>
              </span>
              <Button
                type="submit"
                size="sm"
                disabled={isRecovering}
                data-testid="recover-payment-btn"
              >
                <FileUpIcon className="size-4" />
                <span>
                  {isRecovering
                    ? "Memulihkan..."
                    : recoverablePayment.hasUploadedProofInStorage
                      ? "Tautkan Bukti & Lanjutkan"
                      : "Unggah Bukti & Selesaikan Pengajuan"}
                </span>
              </Button>
            </div>
          </form>
        </div>
      )}

      {!pendingPayment && latestRejectedPayment && (
        <div
          role="alert"
          data-testid="payment-rejected-banner"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">
              Pengajuan pembayaran sebelumnya ditolak oleh Bendahara.
            </p>
            {latestRejectedPayment.rejectionReason && (
              <p className="text-xs">
                Alasan: {latestRejectedPayment.rejectionReason}
              </p>
            )}
            {canSubmitPayment && (
              <p className="text-xs opacity-90">
                Silakan perbaiki bukti atau nominal pembayaran lalu kirim ulang
                melalui formulir di bawah ini.
              </p>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getBillStatusBadgeVariant(bill.status)} size="sm">
              {BILL_STATUS_LABELS[bill.status]}
            </Badge>
            {effectivelyOverdue && bill.status !== "overdue" && (
              <Badge variant="destructive" size="sm">
                Lewat Jatuh Tempo
              </Badge>
            )}
            <Badge variant="info" size="sm">
              {DUES_BILLING_CYCLE_LABELS[bill.dueBillingCycle]}
            </Badge>
            <Badge variant="outline" size="sm">
              {DUES_TARGET_SCOPE_LABELS[bill.dueTargetScope]}
            </Badge>
          </div>
          <CardTitle className="pt-2 text-2xl font-semibold tabular-nums">
            {formatIdr(bill.remainingAmount)}
          </CardTitle>
          <CardDescription>
            Sisa kewajiban yang harus dibayar • Jatuh tempo{" "}
            {formatJakartaDate(bill.dueDate)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Nominal Tagihan</p>
              <p className="mt-0.5 font-semibold tabular-nums text-foreground">
                {formatIdr(bill.amount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sudah Dibayar</p>
              <p className="mt-0.5 font-semibold tabular-nums text-foreground">
                {formatIdr(bill.paidAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Target Tagihan</p>
              <p className="mt-0.5 font-medium text-foreground">
                {bill.targetLabel}
              </p>
            </div>
          </div>

          {canSubmitPayment && (
            <form
              action={formAction}
              data-testid="resident-payment-form"
              className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
            >
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {latestRejectedPayment
                    ? "Kirim Ulang Pembayaran Tagihan"
                    : "Ajukan Pembayaran Tagihan"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Pilih metode pembayaran, masukkan nominal yang dibayarkan, dan
                  unggah bukti transaksi resmi (JPG, PNG, atau PDF maks. 5 MB).
                </p>
              </div>

              {formState.error && (
                <div
                  role="alert"
                  data-testid="resident-payment-error"
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{formState.error}</span>
                </div>
              )}

              <input type="hidden" name="billId" value={bill.id} />
              <input
                type="hidden"
                name="idempotencyNonce"
                value={idempotencyNonce}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="payment-method-select"
                    className="text-xs font-medium text-foreground"
                  >
                    Metode Pembayaran
                  </label>
                  <select
                    id="payment-method-select"
                    name="paymentMethod"
                    defaultValue="transfer"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                  >
                    {Object.entries(RESIDENT_PAYMENT_METHOD_LABELS).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                  {formState.fieldErrors?.paymentMethod?.[0] && (
                    <p className="text-xs text-destructive">
                      {formState.fieldErrors.paymentMethod[0]}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="payment-amount-input"
                    className="text-xs font-medium text-foreground"
                  >
                    Nominal Dibayarkan (IDR)
                  </label>
                  <Input
                    id="payment-amount-input"
                    name="amount"
                    type="text"
                    inputMode="decimal"
                    defaultValue={String(bill.remainingAmount)}
                    required
                  />
                  {formState.fieldErrors?.amount?.[0] && (
                    <p className="text-xs text-destructive">
                      {formState.fieldErrors.amount[0]}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="payment-proof-input"
                  className="text-xs font-medium text-foreground"
                >
                  Bukti Pembayaran (JPG, PNG, PDF • Maks. 5 MB)
                </label>
                <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border bg-muted/20 p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileUpIcon className="size-4 shrink-0" />
                    <span>
                      {selectedFileName ??
                        "Unggah struk transfer, screenshot QRIS, atau bukti setor tunai"}
                    </span>
                  </div>
                  <input
                    id="payment-proof-input"
                    name="proof"
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                    required
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      setSelectedFileName(file ? file.name : null)
                    }}
                    className="text-xs text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted"
                  />
                </div>
                {formState.fieldErrors?.proof?.[0] && (
                  <p className="text-xs text-destructive">
                    {formState.fieldErrors.proof[0]}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="payment-notes-input"
                  className="text-xs font-medium text-foreground"
                >
                  Catatan (Opsional)
                </label>
                <Input
                  id="payment-notes-input"
                  name="notes"
                  type="text"
                  maxLength={500}
                  placeholder="Contoh: Transfer a.n. Budi dari BCA"
                />
                {formState.fieldErrors?.notes?.[0] && (
                  <p className="text-xs text-destructive">
                    {formState.fieldErrors.notes[0]}
                  </p>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending}
                  data-testid="submit-resident-payment-btn"
                >
                  <FileUpIcon className="size-4" />
                  <span>
                    {isPending
                      ? "Mengirim Pembayaran..."
                      : "Kirim Pembayaran & Bukti"}
                  </span>
                </Button>
              </div>
            </form>
          )}

          <div className="border-t border-border pt-3">
            <h2 className="text-sm font-semibold text-foreground">
              Riwayat Pembayaran
            </h2>
            {payments.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Belum ada riwayat pembayaran pada tagihan ini.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    data-testid={`resident-payment-item-${p.id}`}
                    className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">
                          {p.paymentType === "refund"
                            ? "Pengembalian Dana"
                            : "Pembayaran"}{" "}
                          • {PAYMENT_METHOD_LABELS[p.paymentMethod]}
                        </p>
                        <p className="text-muted-foreground">
                          Dikirim: {formatJakartaDateTime(p.paidAt)}
                          {p.verifiedAt
                            ? ` • Diverifikasi: ${formatJakartaDateTime(p.verifiedAt)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatIdr(p.amount)}
                        </span>
                        <Badge
                          variant={
                            p.status === "pending" && p.proofStoragePath === null
                              ? p.isStaleIncomplete
                                ? "outline"
                                : "warning"
                              : getPaymentStatusBadgeVariant(p.status)
                          }
                          size="sm"
                        >
                          {p.status === "pending" && p.proofStoragePath === null
                            ? p.isStaleIncomplete
                              ? "Draft Kedaluwarsa"
                              : "Menunggu Bukti"
                            : PAYMENT_STATUS_LABELS[p.status]}
                        </Badge>
                      </div>
                    </div>

                    {p.notes && (
                      <p className="text-muted-foreground">
                        Catatan: {p.notes}
                      </p>
                    )}

                    {p.status === "rejected" && p.rejectionReason && (
                      <div className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-destructive">
                        Alasan penolakan: {p.rejectionReason}
                      </div>
                    )}

                    {p.proofStoragePath && (
                      <div className="flex items-center justify-end">
                        <a
                          href={`/api/payments/${p.id}/proof`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          <span>Lihat Bukti Pembayaran</span>
                          <ExternalLinkIcon className="size-3" />
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </ResidentContainer>
  )
}

