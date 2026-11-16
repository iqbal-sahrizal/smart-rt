"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BanIcon,
  CalendarIcon,
  CheckCircle2Icon,
  SaveIcon,
  UsersIcon,
} from "lucide-react"

import { cancelBillAction, updateBillAction } from "@/app/actions/finance"
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
  getPaymentStatusBadgeVariant,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type BillPaymentSummary,
  type BillSummary,
  type FinanceFormActionState,
} from "@/lib/finance/types"

interface BillDetailViewProps {
  bill: BillSummary
  payments: BillPaymentSummary[]
  canManageBills: boolean
  notice?: "created" | "updated" | "cancelled" | null
}

const INITIAL_STATE: FinanceFormActionState = { error: null }

export function BillDetailView({
  bill,
  payments,
  canManageBills,
  notice = null,
}: BillDetailViewProps) {
  const [updateState, updateFormAction, isUpdating] = React.useActionState(
    updateBillAction,
    INITIAL_STATE
  )
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelError, setCancelError] = React.useState<string | null>(null)
  const [isCancelling, startCancelTransition] = React.useTransition()

  const isLockedStatus =
    bill.status === "paid" ||
    bill.status === "refunded" ||
    bill.status === "pending_verification"

  const canCancel =
    canManageBills &&
    !isLockedStatus &&
    bill.status !== "cancelled" &&
    bill.paidAmount === 0

  const handleConfirmCancel = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCancelling) return

    setCancelError(null)
    const fd = new FormData()
    fd.set("billId", bill.id)
    startCancelTransition(async () => {
      const result = await cancelBillAction(fd)
      if (result?.error) setCancelError(result.error)
    })
  }

  return (
    <PageContainer>
      <PageHeader
        title={`${bill.dueName} — ${formatBillPeriod(bill.periodYear, bill.periodMonth)}`}
        description={`Tagihan untuk ${bill.targetLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/bills" />}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Kembali ke Daftar</span>
            </Button>
            {canCancel && (
              <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                <DialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="destructive"
                      data-testid="cancel-bill-trigger"
                    />
                  }
                >
                  <BanIcon className="size-4" />
                  <span>Batalkan Tagihan</span>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Batalkan Tagihan</DialogTitle>
                    <DialogDescription>
                      Tagihan &ldquo;{bill.dueName}&rdquo; untuk{" "}
                      {bill.targetLabel} akan diubah statusnya menjadi
                      Dibatalkan. Kebijakan database tidak mengizinkan
                      penghapusan fisik baris tagihan.
                    </DialogDescription>
                  </DialogHeader>
                  {cancelError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {cancelError}
                    </div>
                  )}
                  <form onSubmit={handleConfirmCancel}>
                    <DialogFooter>
                      <DialogClose
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isCancelling}
                          />
                        }
                      >
                        Tutup
                      </DialogClose>
                      <Button
                        type="submit"
                        variant="destructive"
                        disabled={isCancelling}
                        data-testid="confirm-cancel-bill"
                      >
                        {isCancelling ? "Memproses..." : "Ya, Batalkan Tagihan"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      {notice === "created" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Tagihan baru berhasil diterbitkan.</span>
        </div>
      )}

      {notice === "updated" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Perubahan tagihan berhasil disimpan.</span>
        </div>
      )}

      {notice === "cancelled" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Status tagihan berhasil diubah menjadi Dibatalkan.</span>
        </div>
      )}

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={getBillStatusBadgeVariant(bill.status)}>
                {BILL_STATUS_LABELS[bill.status]}
              </Badge>
              <Badge variant="info">
                {DUES_BILLING_CYCLE_LABELS[bill.dueBillingCycle]}
              </Badge>
              <Badge variant="outline">
                {DUES_TARGET_SCOPE_LABELS[bill.dueTargetScope]}
              </Badge>
            </div>
            <CardTitle className="pt-2 text-2xl font-semibold tabular-nums">
              {formatIdr(bill.amount)}
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-3.5" />
                Jatuh tempo: {formatJakartaDate(bill.dueDate)}
              </span>
              <span>
                Periode: {formatBillPeriod(bill.periodYear, bill.periodMonth)}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Total Tagihan</p>
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
                <p className="text-xs text-muted-foreground">Sisa Kewajiban</p>
                <p className="mt-0.5 font-semibold tabular-nums text-primary">
                  {formatIdr(bill.remainingAmount)}
                </p>
              </div>
            </div>

            {canManageBills && !isLockedStatus && (
              <form
                action={updateFormAction}
                className="flex flex-col gap-4 rounded-lg border border-border p-4"
              >
                <input type="hidden" name="billId" value={bill.id} />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Perbarui Tagihan (Khusus Bendahara)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Ubah tanggal jatuh tempo, nominal (jika belum ada pembayaran),
                    atau status penagihan.
                  </p>
                </div>

                {updateState.error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                    <span>{updateState.error}</span>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="edit-bill-amount"
                      className="text-xs font-medium text-foreground"
                    >
                      Nominal (Rp)
                    </label>
                    <Input
                      id="edit-bill-amount"
                      name="amount"
                      type="number"
                      min={0}
                      step="1"
                      required
                      defaultValue={String(bill.amount)}
                      readOnly={bill.paidAmount > 0}
                      disabled={isUpdating}
                    />
                    {updateState.fieldErrors?.amount?.[0] && (
                      <p className="text-xs text-destructive">
                        {updateState.fieldErrors.amount[0]}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="edit-bill-due-date"
                      className="text-xs font-medium text-foreground"
                    >
                      Jatuh Tempo
                    </label>
                    <Input
                      id="edit-bill-due-date"
                      name="dueDate"
                      type="date"
                      required
                      defaultValue={bill.dueDate}
                      disabled={isUpdating}
                    />
                    {updateState.fieldErrors?.dueDate?.[0] && (
                      <p className="text-xs text-destructive">
                        {updateState.fieldErrors.dueDate[0]}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="edit-bill-status"
                      className="text-xs font-medium text-foreground"
                    >
                      Status Tagihan
                    </label>
                    <select
                      id="edit-bill-status"
                      name="status"
                      defaultValue={
                        bill.status === "overdue" ||
                        bill.status === "cancelled"
                          ? bill.status
                          : "unpaid"
                      }
                      disabled={isUpdating}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                    >
                      <option value="unpaid">Belum Dibayar</option>
                      <option value="overdue">Jatuh Tempo</option>
                      {bill.paidAmount === 0 && (
                        <option value="cancelled">Dibatalkan</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isUpdating}
                    data-testid="submit-update-bill-btn"
                  >
                    <SaveIcon className="size-4" />
                    <span>
                      {isUpdating ? "Menyimpan..." : "Simpan Perubahan"}
                    </span>
                  </Button>
                </div>
              </form>
            )}

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Riwayat Pembayaran Terkait
                </h3>
                {canManageBills && (
                  <Button
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                    render={<Link href="/payments" />}
                  >
                    <span>Antrean Verifikasi</span>
                  </Button>
                )}
              </div>
              {payments.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Belum ada catatan pembayaran yang diajukan warga untuk tagihan
                  ini.
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-foreground">
                            {p.paymentType === "refund"
                              ? "Pengembalian Dana"
                              : "Pembayaran"}{" "}
                            ({PAYMENT_METHOD_LABELS[p.paymentMethod]})
                          </p>
                          <p className="text-muted-foreground">
                            {formatJakartaDateTime(p.paidAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatIdr(p.amount)}
                          </span>
                          <Badge
                            variant={getPaymentStatusBadgeVariant(p.status)}
                            size="sm"
                          >
                            {PAYMENT_STATUS_LABELS[p.status]}
                          </Badge>
                          {canManageBills && (
                            <Button
                              nativeButton={false}
                              variant="ghost"
                              size="sm"
                              render={<Link href={`/payments/${p.id}`} />}
                            >
                              <span>Detail</span>
                            </Button>
                          )}
                        </div>
                      </div>
                      {p.status === "rejected" && p.rejectionReason && (
                        <p className="text-destructive">
                          Alasan penolakan: {p.rejectionReason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="size-4 text-muted-foreground" />
              <span>Informasi Target</span>
            </CardTitle>
            <CardDescription>
              {bill.householdId ? "Kartu Keluarga" : "Perorangan Warga"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Penerima</p>
              <p className="mt-0.5 font-medium text-foreground">
                {bill.targetLabel}
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Sumber Iuran</p>
              <Link
                href={`/dues/${bill.dueId}`}
                className="mt-0.5 block font-medium text-primary hover:underline"
              >
                {bill.dueName}
              </Link>
            </div>
            <div className="border-t border-border pt-3 text-xs text-muted-foreground">
              <p>Dibuat: {formatJakartaDateTime(bill.createdAt)}</p>
              <p className="mt-1">
                Diperbarui: {formatJakartaDateTime(bill.updatedAt)}
              </p>
              {bill.paidAt && (
                <p className="mt-1">
                  Lunas: {formatJakartaDateTime(bill.paidAt)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

