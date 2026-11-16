"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  HistoryIcon,
  PlusIcon,
  ReceiptIcon,
  RotateCcwIcon,
  WalletIcon,
} from "lucide-react"

import {
  createCashCategoryAction,
  refundPaymentAction,
  rejectPaymentAction,
  verifyPaymentAction,
} from "@/app/actions/finance"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
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
  formatBillPeriod,
  formatIdr,
  formatJakartaDate,
  formatJakartaDateTime,
  getBillStatusBadgeVariant,
  getPaymentStatusBadgeVariant,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type FinanceFormActionState,
  type PaymentDetailData,
} from "@/lib/finance/types"

interface PaymentDetailViewProps {
  data: PaymentDetailData
  notice?: "verified" | "rejected" | "refunded" | null
}

const INITIAL_STATE: FinanceFormActionState = { error: null }

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "payment.proof_attached": "Bukti pembayaran diunggah",
  "payment.verified": "Pembayaran diverifikasi & dicatat ke kas",
  "payment.rejected": "Pembayaran ditolak",
  "payment.refunded": "Pengembalian dana (refund) diproses",
}

export function PaymentDetailView({
  data,
  notice = null,
}: PaymentDetailViewProps) {
  const {
    payment,
    bill,
    incomeCategories,
    expenseCategories,
    linkedCashTransaction,
    refunds,
    refundedAmount,
    remainingRefundableAmount,
    auditEntries,
  } = data

  const [verifyState, verifyFormAction, isVerifying] = React.useActionState(
    verifyPaymentAction,
    INITIAL_STATE
  )
  const [rejectState, rejectFormAction, isRejecting] = React.useActionState(
    rejectPaymentAction,
    INITIAL_STATE
  )
  const [refundState, refundFormAction, isRefunding] = React.useActionState(
    refundPaymentAction,
    INITIAL_STATE
  )
  const [catState, catFormAction, isCreatingCat] = React.useActionState(
    createCashCategoryAction,
    INITIAL_STATE
  )
  const [expenseCatState, expenseCatFormAction, isCreatingExpenseCat] =
    React.useActionState(createCashCategoryAction, INITIAL_STATE)

  const proofUrl = payment.proofStoragePath
    ? `/api/payments/${payment.id}/proof`
    : null
  const isPdfProof =
    payment.proofStoragePath?.toLowerCase().endsWith(".pdf") ?? false
  const isPendingReview = payment.status === "pending"
  const canIssueRefund =
    payment.paymentType === "payment" &&
    payment.status === "verified" &&
    remainingRefundableAmount > 0

  return (
    <PageContainer>
      <PageHeader
        title="Detail Pembayaran"
        description={`${bill.dueName} • ${formatBillPeriod(bill.periodYear, bill.periodMonth)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link href="/payments" />}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Antrean Verifikasi</span>
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link href={`/bills/${bill.id}`} />}
            >
              <ReceiptIcon className="size-4" />
              <span>Detail Tagihan</span>
            </Button>
          </div>
        }
      />

      {notice === "verified" && (
        <div
          role="status"
          data-testid="payment-verified-banner"
          className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-foreground"
        >
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            Pembayaran berhasil diverifikasi, saldo tagihan diperbarui, dan kas
            masuk telah dicatat.
          </span>
        </div>
      )}

      {notice === "rejected" && (
        <div
          role="status"
          data-testid="payment-rejected-admin-banner"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            Pembayaran ditolak, status tagihan disesuaikan kembali, dan alasan
            penolakan tersimpan di audit log.
          </span>
        </div>
      )}

      {notice === "refunded" && (
        <div
          role="status"
          data-testid="payment-refunded-banner"
          className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm text-foreground"
        >
          <RotateCcwIcon className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            Pengembalian dana (refund) berhasil diproses, saldo tagihan
            direkonsiliasi, dan pengeluaran kas tercatat di buku kas.
          </span>
        </div>
      )}

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-xl font-semibold tabular-nums">
                    {formatIdr(payment.amount)}
                  </CardTitle>
                  <CardDescription>
                    {payment.targetLabel} •{" "}
                    {PAYMENT_METHOD_LABELS[payment.paymentMethod]}
                  </CardDescription>
                </div>
                <Badge
                  variant={getPaymentStatusBadgeVariant(payment.status)}
                  size="sm"
                  data-testid="payment-status-badge"
                >
                  {PAYMENT_STATUS_LABELS[payment.status]}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                <p className="text-muted-foreground">Waktu Pengajuan</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {formatJakartaDateTime(payment.paidAt)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                <p className="text-muted-foreground">Waktu Verifikasi</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {payment.verifiedAt
                    ? formatJakartaDateTime(payment.verifiedAt)
                    : "Belum diverifikasi"}
                </p>
              </div>
              {payment.notes && (
                <div className="rounded-md border border-border bg-muted/20 p-3 text-xs sm:col-span-2">
                  <p className="text-muted-foreground">Catatan Warga</p>
                  <p className="mt-0.5 text-foreground">{payment.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileTextIcon className="size-4 text-primary" />
                    <span>Bukti Pembayaran</span>
                  </CardTitle>
                  <CardDescription>
                    Disajikan dari bucket privat dengan otorisasi Bendahara.
                  </CardDescription>
                </div>
                {proofUrl && (
                  <div className="flex items-center gap-2">
                    <a
                      href={proofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="open-payment-proof-link"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <span>Buka Tab Baru</span>
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                    <a
                      href={`${proofUrl}?download=1`}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <span>Unduh</span>
                    </a>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!proofUrl ? (
                <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                  Tidak ada berkas bukti pembayaran yang terlampir.
                </p>
              ) : isPdfProof ? (
                <iframe
                  src={proofUrl}
                  title="Pratinjau bukti pembayaran PDF"
                  className="h-[460px] w-full rounded-md border border-border bg-muted/20"
                />
              ) : (
                <div className="overflow-hidden rounded-md border border-border bg-muted/20 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={proofUrl}
                    alt={`Bukti pembayaran ${payment.targetLabel}`}
                    data-testid="payment-proof-image"
                    className="mx-auto max-h-[480px] w-auto rounded object-contain"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {linkedCashTransaction && (
            <Card data-testid="linked-cash-transaction-card">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <WalletIcon
                        className={
                          linkedCashTransaction.type === "expense"
                            ? "size-4 text-destructive"
                            : "size-4 text-success"
                        }
                      />
                      <span>
                        {linkedCashTransaction.type === "expense"
                          ? "Catatan Buku Kas Keluar"
                          : "Catatan Buku Kas Masuk"}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      Tercatat otomatis oleh RPC keuangan RT.
                    </CardDescription>
                  </div>
                  <Link
                    href="/cash"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Buka Buku Kas
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-muted-foreground">Kategori Kas</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {linkedCashTransaction.categoryName}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-muted-foreground">Tanggal Transaksi</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {formatJakartaDate(linkedCashTransaction.transactionDate)}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-muted-foreground">
                    {linkedCashTransaction.type === "expense"
                      ? "Nominal Keluar"
                      : "Nominal Masuk"}
                  </p>
                  <p
                    className={
                      linkedCashTransaction.type === "expense"
                        ? "mt-0.5 font-semibold tabular-nums text-destructive"
                        : "mt-0.5 font-semibold tabular-nums text-success"
                    }
                  >
                    {linkedCashTransaction.type === "expense" ? "-" : "+"}
                    {formatIdr(linkedCashTransaction.amount)}
                  </p>
                </div>
                {linkedCashTransaction.description && (
                  <div className="rounded-md border border-border bg-muted/20 p-3 sm:col-span-3">
                    <p className="text-muted-foreground">Keterangan</p>
                    <p className="mt-0.5 text-foreground">
                      {linkedCashTransaction.description}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(refunds.length > 0 || refundedAmount > 0) && (
            <Card data-testid="payment-refunds-card">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <RotateCcwIcon className="size-4 text-warning" />
                      <span>Riwayat Pengembalian Dana (Refund)</span>
                    </CardTitle>
                    <CardDescription>
                      Total direfund: {formatIdr(refundedAmount)} • Sisa dapat
                      direfund: {formatIdr(remainingRefundableAmount)}
                    </CardDescription>
                  </div>
                  <Link
                    href="/cash?type=expense"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Lihat Pengeluaran Kas
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {refunds.map((rf) => (
                  <div
                    key={rf.id}
                    data-testid={`refund-item-${rf.id}`}
                    className="flex flex-col gap-1.5 rounded-md border border-border p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums text-destructive">
                        -{formatIdr(rf.amount)}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={getPaymentStatusBadgeVariant(rf.status)}
                          size="sm"
                        >
                          {PAYMENT_STATUS_LABELS[rf.status]}
                        </Badge>
                        <Link
                          href={`/payments/${rf.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          Rincian
                        </Link>
                      </div>
                    </div>
                    <p className="text-muted-foreground">
                      Diproses: {formatJakartaDateTime(rf.paidAt)}
                    </p>
                    {rf.notes && (
                      <p className="text-foreground">Alasan: {rf.notes}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HistoryIcon className="size-4 text-muted-foreground" />
                <span>Log Audit Pembayaran</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {auditEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Belum ada entri log audit untuk pembayaran ini.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {auditEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-md border border-border p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        <span className="text-muted-foreground">
                          {formatJakartaDateTime(entry.createdAt)}
                        </span>
                      </div>
                      {entry.reason && (
                        <p className="mt-1 text-destructive">
                          Alasan penolakan: {entry.reason}
                        </p>
                      )}
                      {entry.reviewerNotes && (
                        <p className="mt-1 text-muted-foreground">
                          Catatan pemeriksa: {entry.reviewerNotes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {isPendingReview ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2Icon className="size-4 text-success" />
                    <span>Setujui Pembayaran</span>
                  </CardTitle>
                  <CardDescription>
                    Memperbarui tagihan dan mencatat transaksi kas masuk secara
                    atomik.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {incomeCategories.length === 0 ? (
                    <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
                      <p className="text-xs text-foreground">
                        Belum ada kategori kas masuk aktif. Buat kategori
                        terlebih dahulu untuk memverifikasi pembayaran.
                      </p>
                      <form
                        action={catFormAction}
                        className="flex flex-col gap-2"
                      >
                        <input
                          type="hidden"
                          name="returnPaymentId"
                          value={payment.id}
                        />
                        {catState.error && (
                          <p className="text-xs text-destructive">
                            {catState.error}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Input
                            name="name"
                            type="text"
                            placeholder="Contoh: Iuran Warga"
                            required
                          />
                          <Button
                            type="submit"
                            size="sm"
                            disabled={isCreatingCat}
                            data-testid="inline-create-cash-category-btn"
                          >
                            <PlusIcon className="size-4" />
                            <span>Buat</span>
                          </Button>
                        </div>
                      </form>
                    </div>
                  ) : (
                    <form
                      action={verifyFormAction}
                      data-testid="verify-payment-form"
                      className="flex flex-col gap-3"
                    >
                      <input
                        type="hidden"
                        name="paymentId"
                        value={payment.id}
                      />

                      {verifyState.error && (
                        <div
                          role="alert"
                          data-testid="verify-payment-error"
                          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                        >
                          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                          <span>{verifyState.error}</span>
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="verify-cash-category"
                          className="text-xs font-medium text-foreground"
                        >
                          Kategori Kas Masuk
                        </label>
                        <select
                          id="verify-cash-category"
                          name="cashCategoryId"
                          defaultValue={incomeCategories[0]?.id ?? ""}
                          required
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                        >
                          {incomeCategories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="verify-notes"
                          className="text-xs font-medium text-foreground"
                        >
                          Catatan Pemeriksa (Opsional)
                        </label>
                        <textarea
                          id="verify-notes"
                          name="notes"
                          rows={2}
                          maxLength={500}
                          placeholder="Contoh: Mutasi rekening BCA terkonfirmasi"
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                        />
                      </div>

                      <Button
                        type="submit"
                        size="sm"
                        disabled={isVerifying}
                        data-testid="approve-payment-btn"
                      >
                        <CheckCircle2Icon className="size-4" />
                        <span>
                          {isVerifying
                            ? "Memverifikasi..."
                            : "Setujui & Catat ke Kas"}
                        </span>
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BanIcon className="size-4 text-destructive" />
                    <span>Tolak Pembayaran</span>
                  </CardTitle>
                  <CardDescription>
                    Alasan penolakan wajib diisi agar warga dapat menindaklanjuti.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    action={rejectFormAction}
                    data-testid="reject-payment-form"
                    className="flex flex-col gap-3"
                  >
                    <input type="hidden" name="paymentId" value={payment.id} />

                    {rejectState.error && (
                      <div
                        role="alert"
                        data-testid="reject-payment-error"
                        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                      >
                        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                        <span>{rejectState.error}</span>
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="reject-reason-input"
                        className="text-xs font-medium text-foreground"
                      >
                        Alasan Penolakan
                      </label>
                      <textarea
                        id="reject-reason-input"
                        name="reason"
                        rows={3}
                        required
                        minLength={3}
                        maxLength={500}
                        data-testid="reject-reason-input"
                        placeholder="Contoh: Nominal pada struk transfer tidak sesuai atau gambar buram"
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                      />
                      {rejectState.fieldErrors?.reason?.[0] && (
                        <p className="text-xs text-destructive">
                          {rejectState.fieldErrors.reason[0]}
                        </p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      variant="destructive"
                      size="sm"
                      disabled={isRejecting}
                      data-testid="reject-payment-btn"
                    >
                      <BanIcon className="size-4" />
                      <span>
                        {isRejecting ? "Menolak..." : "Tolak Pembayaran"}
                      </span>
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Status Pemeriksaan</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Pembayaran ini berstatus{" "}
                <span className="font-medium text-foreground">
                  {PAYMENT_STATUS_LABELS[payment.status]}
                </span>{" "}
                dan tidak dapat diverifikasi atau ditolak ulang.
              </CardContent>
            </Card>
          )}

          {canIssueRefund && (
            <Card data-testid="refund-payment-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RotateCcwIcon className="size-4 text-warning" />
                  <span>Pengembalian Dana (Refund)</span>
                </CardTitle>
                <CardDescription>
                  Sisa dana dapat direfund:{" "}
                  <span className="font-semibold text-foreground">
                    {formatIdr(remainingRefundableAmount)}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {expenseCategories.length === 0 ? (
                  <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
                    <p className="text-xs text-foreground">
                      Belum ada kategori pengeluaran kas aktif. Tambahkan
                      kategori pengeluaran terlebih dahulu sebelum memproses
                      refund.
                    </p>
                    <form
                      action={expenseCatFormAction}
                      className="flex flex-col gap-2"
                    >
                      <input type="hidden" name="type" value="expense" />
                      <input
                        type="hidden"
                        name="returnPaymentId"
                        value={payment.id}
                      />
                      {expenseCatState.error && (
                        <p className="text-xs text-destructive">
                          {expenseCatState.error}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Input
                          name="name"
                          type="text"
                          placeholder="Contoh: Pengembalian Iuran"
                          required
                        />
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isCreatingExpenseCat}
                          data-testid="inline-create-expense-category-btn"
                        >
                          <PlusIcon className="size-4" />
                          <span>Buat</span>
                        </Button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <form
                    action={refundFormAction}
                    data-testid="refund-payment-form"
                    className="flex flex-col gap-3"
                  >
                    <input
                      type="hidden"
                      name="parentPaymentId"
                      value={payment.id}
                    />

                    {refundState.error && (
                      <div
                        role="alert"
                        data-testid="refund-payment-error"
                        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                      >
                        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                        <span>{refundState.error}</span>
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="refund-amount-input"
                        className="text-xs font-medium text-foreground"
                      >
                        Nominal Refund (IDR)
                      </label>
                      <Input
                        id="refund-amount-input"
                        name="amount"
                        type="text"
                        inputMode="decimal"
                        defaultValue={String(remainingRefundableAmount)}
                        required
                        data-testid="refund-amount-input"
                      />
                      {refundState.fieldErrors?.amount?.[0] && (
                        <p className="text-xs text-destructive">
                          {refundState.fieldErrors.amount[0]}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="refund-cash-category"
                        className="text-xs font-medium text-foreground"
                      >
                        Kategori Pengeluaran Kas
                      </label>
                      <select
                        id="refund-cash-category"
                        name="cashCategoryId"
                        defaultValue={expenseCategories[0]?.id ?? ""}
                        required
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                      >
                        {expenseCategories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="refund-reason-input"
                        className="text-xs font-medium text-foreground"
                      >
                        Alasan Refund
                      </label>
                      <textarea
                        id="refund-reason-input"
                        name="reason"
                        rows={3}
                        required
                        minLength={3}
                        maxLength={500}
                        data-testid="refund-reason-input"
                        placeholder="Contoh: Kelebihan transfer iuran warga atau pembatalan tagihan"
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                      />
                      {refundState.fieldErrors?.reason?.[0] && (
                        <p className="text-xs text-destructive">
                          {refundState.fieldErrors.reason[0]}
                        </p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={isRefunding}
                      data-testid="submit-refund-btn"
                    >
                      <RotateCcwIcon className="size-4" />
                      <span>
                        {isRefunding
                          ? "Memproses Refund..."
                          : "Proses Pengembalian Dana"}
                      </span>
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tagihan Terkait</CardTitle>
              <CardDescription>{bill.dueName}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status Tagihan</span>
                <Badge
                  variant={getBillStatusBadgeVariant(bill.status)}
                  size="sm"
                  data-testid="linked-bill-status-badge"
                >
                  {BILL_STATUS_LABELS[bill.status]}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Target</span>
                <span className="font-medium text-foreground">
                  {bill.targetLabel}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Tagihan</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatIdr(bill.amount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sudah Terbayar</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatIdr(bill.paidAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Sisa Kewajiban</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatIdr(bill.remainingAmount)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}

