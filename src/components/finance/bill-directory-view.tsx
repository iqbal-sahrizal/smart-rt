"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  PlusIcon,
  ReceiptIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react"

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  BILL_STATUS_LABELS,
  INDONESIAN_MONTH_NAMES,
  formatBillPeriod,
  formatIdr,
  formatJakartaDate,
  getBillStatusBadgeVariant,
  type BillSummary,
} from "@/lib/finance/types"

interface BillDirectoryViewProps {
  items: BillSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  dueOptions: Array<{ id: string; name: string }>
  canManageBills: boolean
  filters: {
    search: string
    status: string
    dueId: string
    periodYear: string
    periodMonth: string
  }
  error: string | null
}

function buildBillsUrl(params: {
  search?: string
  status?: string
  dueId?: string
  periodYear?: string
  periodMonth?: string
  page?: number
}): string {
  const qs = new URLSearchParams()
  if (params.search?.trim()) qs.set("q", params.search.trim())
  if (params.status && params.status !== "all") qs.set("status", params.status)
  if (params.dueId && params.dueId !== "all") qs.set("dueId", params.dueId)
  if (params.periodYear && params.periodYear !== "all") {
    qs.set("year", params.periodYear)
  }
  if (params.periodMonth && params.periodMonth !== "all") {
    qs.set("month", params.periodMonth)
  }
  if (params.page && params.page > 1) qs.set("page", String(params.page))
  const serialized = qs.toString()
  return serialized ? `/bills?${serialized}` : "/bills"
}

export function BillDirectoryView({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  dueOptions,
  canManageBills,
  filters,
  error,
}: BillDirectoryViewProps) {
  const router = useRouter()
  const [isNavigating, startTransition] = React.useTransition()
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const statusSelectRef = React.useRef<HTMLSelectElement>(null)
  const dueSelectRef = React.useRef<HTMLSelectElement>(null)
  const monthSelectRef = React.useRef<HTMLSelectElement>(null)
  const yearInputRef = React.useRef<HTMLInputElement>(null)

  const navigateWithFilters = (next: {
    search?: string
    status?: string
    dueId?: string
    periodYear?: string
    periodMonth?: string
    page?: number
  }) => {
    const url = buildBillsUrl(next)
    startTransition(() => {
      router.push(url)
    })
  }

  const readCurrentRefs = () => ({
    search: searchInputRef.current?.value ?? filters.search,
    status: statusSelectRef.current?.value ?? filters.status,
    dueId: dueSelectRef.current?.value ?? filters.dueId,
    periodMonth: monthSelectRef.current?.value ?? filters.periodMonth,
    periodYear: yearInputRef.current?.value ?? filters.periodYear,
  })

  const handleFilterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigateWithFilters({
      ...readCurrentRefs(),
      page: 1,
    })
  }

  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.status !== "all" ||
    filters.dueId !== "all" ||
    (filters.periodYear !== "" && filters.periodYear !== "all") ||
    filters.periodMonth !== "all"

  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, totalCount)

  return (
    <PageContainer>
      <PageHeader
        title="Tagihan Warga"
        description="Pantau dan kelola kewajiban iuran per Kartu Keluarga maupun per warga."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/dues" />}
            >
              <span>Konfigurasi Iuran</span>
            </Button>
            {canManageBills ? (
              <Button
                nativeButton={false}
                render={<Link href="/bills/new" />}
                data-testid="create-bill-btn"
              >
                <PlusIcon className="size-4" />
                <span>Buat Tagihan</span>
              </Button>
            ) : (
              <Badge variant="outline" size="default">
                Mode Baca
              </Badge>
            )}
          </div>
        }
      />

      {!canManageBills && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Sesuai kebijakan akses database, hanya Bendahara yang dapat menerbitkan
          atau memperbarui tagihan warga. Peran pengurus lainnya memiliki akses
          lihat saja.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cari &amp; Filter Tagihan</CardTitle>
          <CardDescription>
            Saring berdasarkan nama iuran, blok/alamat KK, nama warga, status,
            dan periode tagihan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            key={`${filters.search}|${filters.status}|${filters.dueId}|${filters.periodYear}|${filters.periodMonth}`}
            onSubmit={handleFilterSubmit}
            className="grid gap-[var(--space-3)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          >
            <div className="relative sm:col-span-2">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                name="q"
                defaultValue={filters.search}
                placeholder="Cari iuran, unit/alamat KK, atau nama warga..."
                className="pl-9"
              />
            </div>

            <select
              ref={statusSelectRef}
              name="status"
              aria-label="Filter status tagihan"
              defaultValue={filters.status}
              onChange={(event) =>
                navigateWithFilters({
                  ...readCurrentRefs(),
                  status: event.target.value,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Status</option>
              <option value="unpaid">Belum Dibayar</option>
              <option value="partial">Dibayar Sebagian</option>
              <option value="pending_verification">Menunggu Verifikasi</option>
              <option value="overdue">Jatuh Tempo</option>
              <option value="paid">Lunas</option>
              <option value="cancelled">Dibatalkan</option>
              <option value="refunded">Dikembalikan</option>
            </select>

            <select
              ref={dueSelectRef}
              name="dueId"
              aria-label="Filter jenis iuran"
              defaultValue={filters.dueId}
              onChange={(event) =>
                navigateWithFilters({
                  ...readCurrentRefs(),
                  dueId: event.target.value,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Jenis Iuran</option>
              {dueOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              ref={monthSelectRef}
              name="month"
              aria-label="Filter bulan periode"
              defaultValue={filters.periodMonth}
              onChange={(event) =>
                navigateWithFilters({
                  ...readCurrentRefs(),
                  periodMonth: event.target.value,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Bulan</option>
              {INDONESIAN_MONTH_NAMES.map((label, idx) => (
                <option key={label} value={String(idx + 1)}>
                  {label}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <Input
                ref={yearInputRef}
                name="year"
                type="number"
                min={2000}
                max={2100}
                defaultValue={
                  filters.periodYear === "all" ? "" : filters.periodYear
                }
                placeholder="Tahun"
                aria-label="Filter tahun periode"
                className="min-w-0 flex-1 sm:w-24 sm:flex-initial"
              />
              <Button type="submit" variant="secondary" disabled={isNavigating}>
                Cari
              </Button>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Reset Filter"
                  disabled={isNavigating}
                  onClick={() => navigateWithFilters({ page: 1 })}
                >
                  <RotateCcwIcon className="size-4" />
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

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
            <ReceiptIcon className="size-10 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                {hasActiveFilters
                  ? "Tidak ada tagihan yang cocok dengan filter"
                  : "Belum ada tagihan warga"}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasActiveFilters
                  ? "Coba ubah kata kunci pencarian atau reset filter."
                  : canManageBills
                    ? "Terbitkan tagihan satuan atau massal berdasarkan konfigurasi iuran aktif."
                    : "Belum ada tagihan yang diterbitkan oleh Bendahara."}
              </p>
            </div>
            {canManageBills && !hasActiveFilters && (
              <Button
                nativeButton={false}
                size="sm"
                render={<Link href="/bills/new" />}
              >
                <PlusIcon className="size-4" />
                <span>Buat Tagihan</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Daftar Tagihan</CardTitle>
              <CardDescription>
                Menampilkan {startIndex}–{endIndex} dari {totalCount} tagihan
              </CardDescription>
            </div>
            {isNavigating && (
              <span className="text-xs text-muted-foreground">Memuat...</span>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-4)] px-0">
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-[var(--space-6)]">
                      Iuran &amp; Periode
                    </TableHead>
                    <TableHead>Target Tagihan</TableHead>
                    <TableHead>Nominal / Terbayar</TableHead>
                    <TableHead>Jatuh Tempo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-[var(--space-6)] text-right">
                      Aksi
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((bill) => (
                    <TableRow key={bill.id} data-testid={`bill-row-${bill.id}`}>
                      <TableCell className="pl-[var(--space-6)]">
                        <Link
                          href={`/bills/${bill.id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {bill.dueName}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Periode{" "}
                          {formatBillPeriod(bill.periodYear, bill.periodMonth)}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="truncate text-sm text-foreground">
                          {bill.targetLabel}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {bill.householdId ? "Kartu Keluarga" : "Perorangan"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium tabular-nums text-foreground">
                          {formatIdr(bill.amount)}
                        </p>
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          Terbayar: {formatIdr(bill.paidAmount)}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatJakartaDate(bill.dueDate)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getBillStatusBadgeVariant(bill.status)}
                          size="sm"
                        >
                          {BILL_STATUS_LABELS[bill.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-[var(--space-6)] text-right">
                        <Button
                          nativeButton={false}
                          variant="outline"
                          size="sm"
                          render={<Link href={`/bills/${bill.id}`} />}
                        >
                          <EyeIcon className="size-3.5" />
                          <span>Detail</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 px-[var(--space-4)] md:hidden">
              {items.map((bill) => (
                <div
                  key={bill.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/bills/${bill.id}`}
                        className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
                      >
                        {bill.dueName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatBillPeriod(bill.periodYear, bill.periodMonth)} •{" "}
                        {bill.targetLabel}
                      </p>
                    </div>
                    <Badge
                      variant={getBillStatusBadgeVariant(bill.status)}
                      size="sm"
                    >
                      {BILL_STATUS_LABELS[bill.status]}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold tabular-nums text-foreground">
                      {formatIdr(bill.amount)}
                    </span>
                    <span className="text-muted-foreground">
                      Jatuh tempo: {formatJakartaDate(bill.dueDate)}
                    </span>
                  </div>
                  <div className="pt-1">
                    <Button
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                      render={<Link href={`/bills/${bill.id}`} />}
                    >
                      Detail
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-[var(--space-6)] pt-[var(--space-4)]">
                <p className="text-xs text-muted-foreground">
                  Halaman {page} dari {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || isNavigating}
                    onClick={() =>
                      navigateWithFilters({
                        ...filters,
                        page: page - 1,
                      })
                    }
                  >
                    <ChevronLeftIcon className="size-4" />
                    <span>Sebelumnya</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || isNavigating}
                    onClick={() =>
                      navigateWithFilters({
                        ...filters,
                        page: page + 1,
                      })
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
      )}
    </PageContainer>
  )
}

