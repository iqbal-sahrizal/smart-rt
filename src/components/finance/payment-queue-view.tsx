"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileCheck2Icon,
  InboxIcon,
  PlusIcon,
  SearchIcon,
  WalletIcon,
} from "lucide-react"

import { createCashCategoryAction } from "@/app/actions/finance"
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
  formatBillPeriod,
  formatIdr,
  formatJakartaDate,
  formatJakartaDateTime,
  getPaymentStatusBadgeVariant,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type CashCategorySummary,
  type CashTransactionSummary,
  type FinanceFormActionState,
  type PaymentQueueItem,
} from "@/lib/finance/types"

interface PaymentQueueViewProps {
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
  filters: {
    status: string
    method: string
    search: string
  }
  error: string | null
}

const INITIAL_STATE: FinanceFormActionState = { error: null }

export function PaymentQueueView({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  counts,
  incomeCategories,
  recentIncomeTransactions,
  filters,
  error,
}: PaymentQueueViewProps) {
  const router = useRouter()
  const [searchValue, setSearchValue] = React.useState(filters.search)
  const [catState, catFormAction, isCreatingCat] = React.useActionState(
    createCashCategoryAction,
    INITIAL_STATE
  )

  const buildUrl = React.useCallback(
    (next: {
      status?: string
      method?: string
      search?: string
      page?: number
    }) => {
      const params = new URLSearchParams()
      const status = next.status ?? filters.status
      const method = next.method ?? filters.method
      const q = next.search ?? searchValue
      const p = next.page ?? 1

      if (status && status !== "pending") params.set("status", status)
      if (method && method !== "all") params.set("method", method)
      if (q.trim()) params.set("q", q.trim())
      if (p > 1) params.set("page", String(p))

      const qs = params.toString()
      return qs ? `/payments?${qs}` : "/payments"
    },
    [filters.method, filters.status, searchValue]
  )

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(buildUrl({ search: searchValue, page: 1 }))
  }

  const fromIdx = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const toIdx = Math.min(totalCount, page * pageSize)

  const statusTabs: Array<{
    key: string
    label: string
    count: number
  }> = [
    { key: "pending", label: "Menunggu Verifikasi", count: counts.pending },
    { key: "verified", label: "Terverifikasi", count: counts.verified },
    { key: "rejected", label: "Ditolak", count: counts.rejected },
    { key: "all", label: "Semua", count: counts.all },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Verifikasi Pembayaran"
        description="Periksa bukti bayar warga, verifikasi pembayaran ke buku kas RT, atau tolak dengan alasan."
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            size="sm"
            render={<Link href="/bills" />}
          >
            <span>Lihat Tagihan Warga</span>
          </Button>
        }
      />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {statusTabs.map((tab) => {
          const active = filters.status === tab.key
          return (
            <Button
              key={tab.key}
              nativeButton={false}
              variant={active ? "default" : "outline"}
              size="sm"
              render={
                <Link
                  href={buildUrl({ status: tab.key, page: 1 })}
                  data-testid={`payment-tab-${tab.key}`}
                />
              }
            >
              <span>{tab.label}</span>
              <Badge
                variant={active ? "secondary" : "outline"}
                size="sm"
                className="ml-1 tabular-nums"
              >
                {tab.count}
              </Badge>
            </Button>
          )
        })}
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Cari nama warga, KK, iuran, atau ID pembayaran..."
                className="pl-9"
              />
            </div>

            <select
              aria-label="Filter metode pembayaran"
              value={filters.method}
              onChange={(e) =>
                router.push(buildUrl({ method: e.target.value, page: 1 }))
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
            >
              <option value="all">Semua Metode</option>
              <option value="transfer">Transfer Bank</option>
              <option value="qris">QRIS</option>
              <option value="cash">Tunai</option>
              <option value="gateway">Payment Gateway</option>
            </select>

            <Button type="submit" size="sm">
              Cari
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileCheck2Icon className="size-4 text-primary" />
                <span>Daftar Pengajuan Pembayaran</span>
              </CardTitle>
              <CardDescription>
                Menampilkan {fromIdx}–{toIdx} dari {totalCount} pengajuan
              </CardDescription>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 py-10 text-center">
                  <InboxIcon className="size-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    Belum ada pengajuan pada filter ini
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pembayaran yang dikirim warga akan tampil di sini untuk
                    diperiksa Bendahara.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`payment-queue-item-${item.id}`}
                      className="flex flex-col justify-between gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={getPaymentStatusBadgeVariant(item.status)}
                            size="sm"
                          >
                            {PAYMENT_STATUS_LABELS[item.status]}
                          </Badge>
                          <Badge variant="outline" size="sm">
                            {PAYMENT_METHOD_LABELS[item.paymentMethod]}
                          </Badge>
                          <Badge
                            variant={item.proofStoragePath ? "info" : "outline"}
                            size="sm"
                          >
                            {item.proofStoragePath
                              ? "Ada Bukti"
                              : "Tanpa Bukti"}
                          </Badge>
                        </div>
                        <p className="truncate font-medium text-foreground">
                          {item.targetLabel} — {item.dueName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Periode{" "}
                          {item.periodYear > 0
                            ? formatBillPeriod(item.periodYear, item.periodMonth)
                            : "—"}{" "}
                          • Dikirim {formatJakartaDateTime(item.paidAt)}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                        <p className="text-base font-semibold tabular-nums text-foreground">
                          {formatIdr(item.amount)}
                        </p>
                        <Button
                          nativeButton={false}
                          size="sm"
                          variant={
                            item.status === "pending" ? "default" : "outline"
                          }
                          render={
                            <Link
                              href={`/payments/${item.id}`}
                              data-testid={`inspect-payment-${item.id}`}
                            />
                          }
                        >
                          <span>
                            {item.status === "pending"
                              ? "Periksa & Proses"
                              : "Lihat Detail"}
                          </span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                  <span className="text-xs text-muted-foreground">
                    Halaman {page} dari {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      render={
                        page > 1 ? (
                          <Link href={buildUrl({ page: page - 1 })} />
                        ) : (
                          <span />
                        )
                      }
                    >
                      <ChevronLeftIcon className="size-4" />
                      <span>Sebelumnya</span>
                    </Button>
                    <Button
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      render={
                        page < totalPages ? (
                          <Link href={buildUrl({ page: page + 1 })} />
                        ) : (
                          <span />
                        )
                      }
                    >
                      <span>Berikutnya</span>
                      <ChevronRightIcon className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <WalletIcon className="size-4 text-primary" />
                <span>Kategori Kas Masuk</span>
              </CardTitle>
              <CardDescription>
                Kategori kas masuk aktif digunakan saat menyetujui pembayaran.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {incomeCategories.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Belum ada kategori kas masuk aktif. Tambahkan kategori (mis.
                  &ldquo;Iuran Warga&rdquo;) sebelum memverifikasi pembayaran.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {incomeCategories.map((cat) => (
                    <Badge key={cat.id} variant="outline" size="sm">
                      {cat.name}
                    </Badge>
                  ))}
                </div>
              )}

              <form
                action={catFormAction}
                className="flex flex-col gap-2 border-t border-border pt-3"
              >
                <label
                  htmlFor="new-cash-category-name"
                  className="text-xs font-medium text-foreground"
                >
                  Tambah Kategori Kas Masuk
                </label>
                {catState.error && (
                  <p className="text-xs text-destructive">{catState.error}</p>
                )}
                {catState.successMessage && (
                  <p className="flex items-center gap-1 text-xs text-success">
                    <CheckCircle2Icon className="size-3.5 shrink-0" />
                    <span>{catState.successMessage}</span>
                  </p>
                )}
                <div className="flex gap-2">
                  <Input
                    id="new-cash-category-name"
                    name="name"
                    type="text"
                    placeholder="Contoh: Iuran Warga"
                    required
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isCreatingCat}
                    data-testid="create-cash-category-btn"
                  >
                    <PlusIcon className="size-4" />
                    <span>{isCreatingCat ? "..." : "Tambah"}</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kas Masuk Terbaru</CardTitle>
              <CardDescription>
                Entri kas tercatat otomatis saat pembayaran disetujui.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentIncomeTransactions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Belum ada transaksi kas masuk tercatat.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {recentIncomeTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      data-testid={`cash-tx-item-${tx.id}`}
                      className="rounded-md border border-border p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {tx.categoryName}
                        </span>
                        <span className="font-semibold tabular-nums text-success">
                          +{formatIdr(tx.amount)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-muted-foreground">
                        {formatJakartaDate(tx.transactionDate)}
                        {tx.description ? ` • ${tx.description}` : ""}
                      </p>
                      {tx.paymentId && (
                        <Link
                          href={`/payments/${tx.paymentId}`}
                          className="mt-1 inline-block text-primary hover:underline"
                        >
                          Lihat Pembayaran
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}

