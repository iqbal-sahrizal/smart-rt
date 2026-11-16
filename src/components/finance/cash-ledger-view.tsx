"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Edit3Icon,
  FilterIcon,
  InfoIcon,
  LandmarkIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  WalletIcon,
} from "lucide-react"

import {
  createCashCategoryAction,
  createCashExpenseAction,
  toggleCashCategoryAction,
  updateCashExpenseAction,
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  CASH_TRANSACTION_TYPE_LABELS,
  formatIdr,
  formatJakartaDate,
  type CashCategorySummary,
  type CashLedgerSummary,
  type CashTransactionSummary,
  type FinanceFormActionState,
} from "@/lib/finance/types"

interface CashLedgerViewProps {
  items: CashTransactionSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  summary: CashLedgerSummary
  categories: CashCategorySummary[]
  filters: {
    type: string
    categoryId: string
    startDate: string
    endDate: string
    search: string
  }
  todayIso: string
  canManageExpenses: boolean
  canManageCategories: boolean
  canOpenPayments: boolean
  notice?: "created" | "updated" | null
  error: string | null
}

const INITIAL_STATE: FinanceFormActionState = { error: null }

export function CashLedgerView({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  summary,
  categories,
  filters,
  todayIso,
  canManageExpenses,
  canManageCategories,
  canOpenPayments,
  notice = null,
  error,
}: CashLedgerViewProps) {
  const router = useRouter()

  const [searchValue, setSearchValue] = React.useState(filters.search)
  const [startDateValue, setStartDateValue] = React.useState(filters.startDate)
  const [endDateValue, setEndDateValue] = React.useState(filters.endDate)
  const [categoryFilterValue, setCategoryFilterValue] = React.useState(
    filters.categoryId
  )
  const [editingTx, setEditingTx] =
    React.useState<CashTransactionSummary | null>(null)
  const [toggleError, setToggleError] = React.useState<string | null>(null)
  const [isTogglingCategory, startToggleTransition] = React.useTransition()

  const [createExpenseState, createExpenseAction, isCreatingExpense] =
    React.useActionState(createCashExpenseAction, INITIAL_STATE)
  const [updateExpenseState, updateExpenseAction, isUpdatingExpense] =
    React.useActionState(updateCashExpenseAction, INITIAL_STATE)
  const [catState, catFormAction, isCreatingCat] = React.useActionState(
    createCashCategoryAction,
    INITIAL_STATE
  )

  const activeExpenseCategories = categories.filter(
    (c) => c.type === "expense" && c.isActive
  )

  const hasActiveFilter =
    filters.type !== "all" ||
    filters.categoryId !== "all" ||
    Boolean(filters.startDate) ||
    Boolean(filters.endDate) ||
    Boolean(filters.search)

  const buildUrl = React.useCallback(
    (next: {
      type?: string
      categoryId?: string
      startDate?: string
      endDate?: string
      search?: string
      page?: number
    }) => {
      const params = new URLSearchParams()
      const type = next.type ?? filters.type
      const categoryId = next.categoryId ?? categoryFilterValue
      const startDate = next.startDate ?? startDateValue
      const endDate = next.endDate ?? endDateValue
      const search = next.search ?? searchValue
      const p = next.page ?? 1

      if (type && type !== "all") params.set("type", type)
      if (categoryId && categoryId !== "all") params.set("category", categoryId)
      if (startDate) params.set("from", startDate)
      if (endDate) params.set("to", endDate)
      if (search.trim()) params.set("q", search.trim())
      if (p > 1) params.set("page", String(p))

      const qs = params.toString()
      return qs ? `/cash?${qs}` : "/cash"
    },
    [
      categoryFilterValue,
      endDateValue,
      filters.type,
      searchValue,
      startDateValue,
    ]
  )

  const handleFilterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(buildUrl({ page: 1 }))
  }

  const handleResetFilters = () => {
    setSearchValue("")
    setStartDateValue("")
    setEndDateValue("")
    setCategoryFilterValue("all")
    router.push("/cash")
  }

  const handleToggleCategory = (cat: CashCategorySummary) => {
    if (isTogglingCategory) return
    setToggleError(null)
    const fd = new FormData()
    fd.set("categoryId", cat.id)
    fd.set("isActive", cat.isActive ? "false" : "true")
    startToggleTransition(async () => {
      const result = await toggleCashCategoryAction(fd)
      if (result?.error) {
        setToggleError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, totalCount)

  return (
    <PageContainer>
      <PageHeader
        title="Kas & Pengeluaran RT"
        description="Buku kas pemasukan iuran, refund, dan pengeluaran operasional RT."
        actions={
          canOpenPayments ? (
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link href="/payments" />}
            >
              <WalletIcon className="size-4" />
              <span>Verifikasi Pembayaran</span>
            </Button>
          ) : null
        }
      />

      {notice === "created" && (
        <div
          role="status"
          data-testid="cash-expense-created-banner"
          className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-foreground"
        >
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
          <span>Pengeluaran kas berhasil dicatat dan saldo kas diperbarui.</span>
        </div>
      )}

      {notice === "updated" && (
        <div
          role="status"
          data-testid="cash-expense-updated-banner"
          className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-foreground"
        >
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
          <span>Perubahan transaksi pengeluaran kas berhasil disimpan.</span>
        </div>
      )}

      <div className="grid gap-[var(--space-4)] sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <ArrowDownLeftIcon className="size-3.5 text-success" />
              <span>Total Kas Masuk</span>
            </CardDescription>
            <CardTitle
              className="text-xl font-semibold tabular-nums text-success"
              data-testid="cash-summary-income"
            >
              {formatIdr(summary.totalIncome)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {hasActiveFilter
              ? `Sesuai filter: ${formatIdr(summary.filteredIncome)}`
              : "Akumulasi pemasukan terverifikasi"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <ArrowUpRightIcon className="size-3.5 text-destructive" />
              <span>Total Pengeluaran</span>
            </CardDescription>
            <CardTitle
              className="text-xl font-semibold tabular-nums text-destructive"
              data-testid="cash-summary-expense"
            >
              {formatIdr(summary.totalExpense)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {hasActiveFilter
              ? `Sesuai filter: ${formatIdr(summary.filteredExpense)}`
              : "Mencakup pengeluaran manual & refund"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <LandmarkIcon className="size-3.5 text-primary" />
              <span>Saldo Kas Bersih</span>
            </CardDescription>
            <CardTitle
              className="text-xl font-semibold tabular-nums text-foreground"
              data-testid="cash-summary-balance"
            >
              {formatIdr(summary.netBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            {hasActiveFilter
              ? `Selisih filter: ${formatIdr(summary.filteredNet)}`
              : "Selisih kas masuk dikurangi pengeluaran"}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Untuk menjaga integritas audit keuangan RT, catatan transaksi kas
          tidak dapat dihapus langsung. Transaksi yang berasal dari verifikasi
          pembayaran atau refund sistem bersifat permanen dan tidak dapat
          diubah.{" "}
          {!canManageExpenses &&
            "Peran Anda saat ini memiliki akses lihat-saja (read-only) untuk buku kas."}
        </p>
      </div>

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { key: "all", label: "Semua Transaksi" },
                    { key: "income", label: "Kas Masuk" },
                    { key: "expense", label: "Pengeluaran" },
                  ] as const
                ).map((tab) => {
                  const active = filters.type === tab.key
                  return (
                    <Button
                      key={tab.key}
                      nativeButton={false}
                      variant={active ? "default" : "outline"}
                      size="sm"
                      render={<Link href={buildUrl({ type: tab.key, page: 1 })} />}
                    >
                      <span>{tab.label}</span>
                    </Button>
                  )
                })}
              </div>

              <form
                onSubmit={handleFilterSubmit}
                data-testid="cash-filter-form"
                className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
              >
                <div className="relative sm:col-span-2">
                  <SearchIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
                  <Input
                    type="search"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder="Cari keterangan atau kategori..."
                    className="pl-9"
                  />
                </div>

                <select
                  aria-label="Filter kategori kas"
                  value={categoryFilterValue}
                  onChange={(e) => setCategoryFilterValue(e.target.value)}
                  className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none sm:col-span-2"
                >
                  <option value="all">Semua Kategori</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} (
                      {cat.type === "income" ? "Masuk" : "Keluar"})
                    </option>
                  ))}
                </select>

                <Input
                  type="date"
                  aria-label="Tanggal mulai"
                  value={startDateValue}
                  onChange={(e) => setStartDateValue(e.target.value)}
                />

                <Input
                  type="date"
                  aria-label="Tanggal akhir"
                  value={endDateValue}
                  onChange={(e) => setEndDateValue(e.target.value)}
                />

                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <Button type="submit" size="sm" variant="outline">
                    <FilterIcon className="size-3.5" />
                    <span>Terapkan Filter</span>
                  </Button>
                  {hasActiveFilter && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleResetFilters}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daftar Transaksi Kas</CardTitle>
              <CardDescription>
                Menampilkan {startIndex}–{endIndex} dari {totalCount} transaksi.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {error && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <AlertCircleIcon className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Belum ada transaksi kas pada filter ini.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Transaksi tercatat otomatis dari pembayaran iuran/refund
                    atau pencatatan pengeluaran oleh Bendahara.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {items.map((tx) => {
                    const isManualExpense =
                      tx.paymentId === null && tx.type === "expense"
                    return (
                      <div
                        key={tx.id}
                        data-testid={`cash-ledger-item-${tx.id}`}
                        className="flex flex-col justify-between gap-3 rounded-lg border border-border p-3.5 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                tx.type === "income" ? "success" : "destructive"
                              }
                              size="sm"
                            >
                              {CASH_TRANSACTION_TYPE_LABELS[tx.type]}
                            </Badge>
                            <span className="text-sm font-semibold text-foreground">
                              {tx.categoryName}
                            </span>
                            {tx.paymentId ? (
                              <Badge variant="outline" size="sm">
                                <LockIcon className="mr-1 size-3" />
                                <span>Terkait Pembayaran</span>
                              </Badge>
                            ) : (
                              <Badge variant="info" size="sm">
                                Manual
                              </Badge>
                            )}
                          </div>

                          <p className="text-xs text-muted-foreground">
                            {formatJakartaDate(tx.transactionDate)}
                            {tx.description ? ` • ${tx.description}` : ""}
                          </p>

                          {tx.paymentId && canOpenPayments && (
                            <Link
                              href={`/payments/${tx.paymentId}`}
                              className="inline-block text-xs font-medium text-primary hover:underline"
                            >
                              Lihat Pembayaran Terkait
                            </Link>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <span
                            className={
                              tx.type === "income"
                                ? "font-semibold tabular-nums text-success"
                                : "font-semibold tabular-nums text-destructive"
                            }
                          >
                            {tx.type === "income" ? "+" : "-"}
                            {formatIdr(tx.amount)}
                          </span>

                          {canManageExpenses && isManualExpense && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-testid={`edit-cash-tx-btn-${tx.id}`}
                              onClick={() => setEditingTx(tx)}
                            >
                              <Edit3Icon className="size-3.5" />
                              <span>Ubah</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span>
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

        <div className="flex min-w-0 flex-col gap-4">
          {canManageExpenses && (
            <Card data-testid="create-cash-expense-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowUpRightIcon className="size-4 text-destructive" />
                  <span>Catat Pengeluaran Kas</span>
                </CardTitle>
                <CardDescription>
                  Hanya Bendahara yang dapat mencatat atau mengubah pengeluaran
                  manual.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {activeExpenseCategories.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    Belum ada kategori pengeluaran aktif. Tambahkan kategori
                    bertipe &ldquo;Pengeluaran&rdquo; pada panel di bawah
                    terlebih dahulu.
                  </p>
                ) : (
                  <form
                    action={createExpenseAction}
                    data-testid="create-cash-expense-form"
                    className="flex flex-col gap-3"
                  >
                    {createExpenseState.error && (
                      <div
                        role="alert"
                        data-testid="create-cash-expense-error"
                        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                      >
                        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                        <span>{createExpenseState.error}</span>
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="expense-category-select"
                        className="text-xs font-medium text-foreground"
                      >
                        Kategori Pengeluaran
                      </label>
                      <select
                        id="expense-category-select"
                        name="categoryId"
                        defaultValue={activeExpenseCategories[0]?.id ?? ""}
                        required
                        className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                      >
                        {activeExpenseCategories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="expense-amount-input"
                        className="text-xs font-medium text-foreground"
                      >
                        Nominal (IDR)
                      </label>
                      <Input
                        id="expense-amount-input"
                        name="amount"
                        type="text"
                        inputMode="decimal"
                        placeholder="Contoh: 150000"
                        required
                        data-testid="expense-amount-input"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="expense-date-input"
                        className="text-xs font-medium text-foreground"
                      >
                        Tanggal Transaksi
                      </label>
                      <Input
                        id="expense-date-input"
                        name="transactionDate"
                        type="date"
                        defaultValue={todayIso}
                        required
                        data-testid="expense-date-input"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="expense-description-input"
                        className="text-xs font-medium text-foreground"
                      >
                        Keterangan Pengeluaran
                      </label>
                      <textarea
                        id="expense-description-input"
                        name="description"
                        rows={3}
                        required
                        minLength={3}
                        maxLength={500}
                        data-testid="expense-description-input"
                        placeholder="Contoh: Pembelian lampu penerangan gang RT 05"
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                      />
                    </div>

                    <Button
                      type="submit"
                      size="sm"
                      disabled={isCreatingExpense}
                      data-testid="create-cash-expense-btn"
                    >
                      <PlusIcon className="size-4" />
                      <span>
                        {isCreatingExpense
                          ? "Menyimpan..."
                          : "Simpan Pengeluaran"}
                      </span>
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          <Card data-testid="cash-categories-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <WalletIcon className="size-4 text-primary" />
                <span>Kategori Kas RT</span>
              </CardTitle>
              <CardDescription>
                {canManageCategories
                  ? "Ketua RT dan Bendahara dapat mengelola kategori pemasukan & pengeluaran."
                  : "Daftar kategori pemasukan & pengeluaran kas RT."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {toggleError && (
                <p className="text-xs text-destructive">{toggleError}</p>
              )}

              {categories.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  Belum ada kategori kas tercatat.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      data-testid={`cash-category-row-${cat.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant={
                            cat.type === "income" ? "success" : "destructive"
                          }
                          size="sm"
                        >
                          {cat.type === "income" ? "Masuk" : "Keluar"}
                        </Badge>
                        <span
                          className={
                            cat.isActive
                              ? "truncate font-medium text-foreground"
                              : "truncate text-muted-foreground line-through"
                          }
                        >
                          {cat.name}
                        </span>
                      </div>

                      {canManageCategories ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isTogglingCategory}
                          data-testid={`toggle-category-btn-${cat.id}`}
                          onClick={() => handleToggleCategory(cat)}
                        >
                          <span>{cat.isActive ? "Nonaktifkan" : "Aktifkan"}</span>
                        </Button>
                      ) : (
                        <Badge variant="outline" size="sm">
                          {cat.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {canManageCategories && (
                <form
                  action={catFormAction}
                  data-testid="create-cash-category-form"
                  className="flex flex-col gap-2 border-t border-border pt-3"
                >
                  <input type="hidden" name="source" value="cash" />
                  <p className="text-xs font-medium text-foreground">
                    Tambah Kategori Kas Baru
                  </p>
                  {catState.error && (
                    <p className="text-xs text-destructive">{catState.error}</p>
                  )}
                  {catState.successMessage && (
                    <p className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2Icon className="size-3.5 shrink-0" />
                      <span>{catState.successMessage}</span>
                    </p>
                  )}
                  <select
                    aria-label="Tipe kategori baru"
                    name="type"
                    defaultValue="expense"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                  >
                    <option value="expense">Pengeluaran Kas</option>
                    <option value="income">Kas Masuk</option>
                  </select>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      name="name"
                      type="text"
                      placeholder="Contoh: Operasional Kebersihan"
                      required
                      data-testid="new-cash-category-input"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isCreatingCat}
                      data-testid="create-cash-category-btn"
                      className="shrink-0"
                    >
                      <PlusIcon className="size-4" />
                      <span>{isCreatingCat ? "..." : "Tambah"}</span>
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={editingTx !== null}
        onOpenChange={(open) => {
          if (!open) setEditingTx(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah Pengeluaran Kas Manual</DialogTitle>
            <DialogDescription>
              Perbarui kategori, nominal, tanggal, atau keterangan transaksi
              pengeluaran ini.
            </DialogDescription>
          </DialogHeader>

          {editingTx && (
            <form
              key={editingTx.id}
              action={updateExpenseAction}
              data-testid="edit-cash-expense-form"
              className="flex flex-col gap-3"
            >
              <input
                type="hidden"
                name="transactionId"
                value={editingTx.id}
              />

              {updateExpenseState.error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{updateExpenseState.error}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="edit-expense-category"
                  className="text-xs font-medium text-foreground"
                >
                  Kategori Pengeluaran
                </label>
                <select
                  id="edit-expense-category"
                  name="categoryId"
                  defaultValue={editingTx.categoryId}
                  required
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                >
                  {activeExpenseCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="edit-expense-amount"
                  className="text-xs font-medium text-foreground"
                >
                  Nominal (IDR)
                </label>
                <Input
                  id="edit-expense-amount"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  defaultValue={String(editingTx.amount)}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="edit-expense-date"
                  className="text-xs font-medium text-foreground"
                >
                  Tanggal Transaksi
                </label>
                <Input
                  id="edit-expense-date"
                  name="transactionDate"
                  type="date"
                  defaultValue={editingTx.transactionDate}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="edit-expense-description"
                  className="text-xs font-medium text-foreground"
                >
                  Keterangan
                </label>
                <textarea
                  id="edit-expense-description"
                  name="description"
                  rows={3}
                  defaultValue={editingTx.description ?? ""}
                  required
                  minLength={3}
                  maxLength={500}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                />
              </div>

              <DialogFooter>
                <DialogClose
                  render={
                    <Button type="button" variant="outline" size="sm">
                      Batal
                    </Button>
                  }
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={isUpdatingExpense}
                  data-testid="save-edit-cash-expense-btn"
                >
                  <span>
                    {isUpdatingExpense ? "Menyimpan..." : "Simpan Perubahan"}
                  </span>
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

