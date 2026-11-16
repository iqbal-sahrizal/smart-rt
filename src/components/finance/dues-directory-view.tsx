"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  WalletIcon,
} from "lucide-react"

import { DuesDeleteDialog } from "@/components/finance/dues-delete-dialog"
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
  DUES_BILLING_CYCLE_LABELS,
  DUES_TARGET_SCOPE_LABELS,
  formatIdr,
  formatJakartaDate,
  type DuesSummary,
} from "@/lib/finance/types"

interface DuesDirectoryViewProps {
  items: DuesSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  canManage: boolean
  canManageBills: boolean
  filters: {
    search: string
    billingCycle: string
    targetScope: string
    activeFilter: string
  }
  error: string | null
  deletedNotice?: boolean
}

function buildDuesUrl(params: {
  search?: string
  billingCycle?: string
  targetScope?: string
  activeFilter?: string
  page?: number
}): string {
  const qs = new URLSearchParams()
  if (params.search?.trim()) qs.set("q", params.search.trim())
  if (params.billingCycle && params.billingCycle !== "all") {
    qs.set("cycle", params.billingCycle)
  }
  if (params.targetScope && params.targetScope !== "all") {
    qs.set("scope", params.targetScope)
  }
  if (params.activeFilter && params.activeFilter !== "all") {
    qs.set("active", params.activeFilter)
  }
  if (params.page && params.page > 1) qs.set("page", String(params.page))
  const serialized = qs.toString()
  return serialized ? `/dues?${serialized}` : "/dues"
}

export function DuesDirectoryView({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  canManage,
  canManageBills,
  filters,
  error,
  deletedNotice = false,
}: DuesDirectoryViewProps) {
  const router = useRouter()
  const [isNavigating, startTransition] = React.useTransition()
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const cycleSelectRef = React.useRef<HTMLSelectElement>(null)
  const scopeSelectRef = React.useRef<HTMLSelectElement>(null)
  const activeSelectRef = React.useRef<HTMLSelectElement>(null)

  const navigateWithFilters = (next: {
    search?: string
    billingCycle?: string
    targetScope?: string
    activeFilter?: string
    page?: number
  }) => {
    const url = buildDuesUrl(next)
    startTransition(() => {
      router.push(url)
    })
  }

  const handleFilterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigateWithFilters({
      search: searchInputRef.current?.value ?? filters.search,
      billingCycle: cycleSelectRef.current?.value ?? filters.billingCycle,
      targetScope: scopeSelectRef.current?.value ?? filters.targetScope,
      activeFilter: activeSelectRef.current?.value ?? filters.activeFilter,
      page: 1,
    })
  }

  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.billingCycle !== "all" ||
    filters.targetScope !== "all" ||
    filters.activeFilter !== "all"

  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, totalCount)

  return (
    <PageContainer>
      <PageHeader
        title="Konfigurasi Iuran RT"
        description="Atur jenis iuran rutin maupun insidental beserta tarif dan target penagihannya."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageBills && (
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link href="/bills/new" />}
              >
                <span>Buat Tagihan</span>
              </Button>
            )}
            {canManage ? (
              <Button
                nativeButton={false}
                render={<Link href="/dues/new" />}
                data-testid="create-dues-btn"
              >
                <PlusIcon className="size-4" />
                <span>Tambah Iuran</span>
              </Button>
            ) : (
              <Badge variant="outline" size="default">
                Mode Baca
              </Badge>
            )}
          </div>
        }
      />

      {deletedNotice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Konfigurasi iuran berhasil dihapus.</span>
        </div>
      )}

      {!canManage && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Peran Anda memiliki akses baca saja terhadap konfigurasi iuran.
          Pembuatan, pembaruan, dan penghapusan iuran hanya dapat dilakukan oleh
          Ketua RT atau Bendahara.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cari &amp; Filter Iuran</CardTitle>
          <CardDescription>
            Saring berdasarkan nama iuran, siklus penagihan, cakupan target, atau
            status aktif.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            key={`${filters.search}|${filters.billingCycle}|${filters.targetScope}|${filters.activeFilter}`}
            onSubmit={handleFilterSubmit}
            className="flex flex-col gap-[var(--space-3)] lg:flex-row lg:items-center"
          >
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                name="q"
                defaultValue={filters.search}
                placeholder="Cari nama atau keterangan iuran..."
                className="pl-9"
              />
            </div>

            <select
              ref={cycleSelectRef}
              name="cycle"
              aria-label="Filter siklus penagihan"
              defaultValue={filters.billingCycle}
              onChange={(event) =>
                navigateWithFilters({
                  search: searchInputRef.current?.value ?? filters.search,
                  billingCycle: event.target.value,
                  targetScope:
                    scopeSelectRef.current?.value ?? filters.targetScope,
                  activeFilter:
                    activeSelectRef.current?.value ?? filters.activeFilter,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Siklus</option>
              <option value="monthly">Bulanan</option>
              <option value="yearly">Tahunan</option>
              <option value="one_time">Sekali Bayar</option>
            </select>

            <select
              ref={scopeSelectRef}
              name="scope"
              aria-label="Filter target cakupan"
              defaultValue={filters.targetScope}
              onChange={(event) =>
                navigateWithFilters({
                  search: searchInputRef.current?.value ?? filters.search,
                  billingCycle:
                    cycleSelectRef.current?.value ?? filters.billingCycle,
                  targetScope: event.target.value,
                  activeFilter:
                    activeSelectRef.current?.value ?? filters.activeFilter,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Target</option>
              <option value="household">Per Kartu Keluarga</option>
              <option value="resident">Per Warga</option>
            </select>

            <select
              ref={activeSelectRef}
              name="active"
              aria-label="Filter status aktif"
              defaultValue={filters.activeFilter}
              onChange={(event) =>
                navigateWithFilters({
                  search: searchInputRef.current?.value ?? filters.search,
                  billingCycle:
                    cycleSelectRef.current?.value ?? filters.billingCycle,
                  targetScope:
                    scopeSelectRef.current?.value ?? filters.targetScope,
                  activeFilter: event.target.value,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Status</option>
              <option value="active">Aktif</option>
              <option value="inactive">Nonaktif</option>
            </select>

            <div className="flex items-center gap-2">
              <Button type="submit" variant="secondary" disabled={isNavigating}>
                Cari
              </Button>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isNavigating}
                  onClick={() => navigateWithFilters({ page: 1 })}
                >
                  <RotateCcwIcon className="size-4" />
                  <span>Reset</span>
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
            <WalletIcon className="size-10 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                {hasActiveFilters
                  ? "Tidak ada konfigurasi iuran yang cocok"
                  : "Belum ada konfigurasi iuran"}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasActiveFilters
                  ? "Coba ubah kata kunci pencarian atau reset filter."
                  : canManage
                    ? "Tambahkan jenis iuran pertama untuk mulai menerbitkan tagihan warga."
                    : "Belum ada konfigurasi iuran yang ditetapkan pengurus RT."}
              </p>
            </div>
            {canManage && !hasActiveFilters && (
              <Button
                nativeButton={false}
                size="sm"
                render={<Link href="/dues/new" />}
              >
                <PlusIcon className="size-4" />
                <span>Tambah Iuran</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Daftar Konfigurasi Iuran</CardTitle>
              <CardDescription>
                Menampilkan {startIndex}–{endIndex} dari {totalCount} iuran
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
                    <TableHead className="pl-[var(--space-6)]">Nama Iuran</TableHead>
                    <TableHead>Tarif Default</TableHead>
                    <TableHead>Siklus</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Diperbarui</TableHead>
                    <TableHead className="pr-[var(--space-6)] text-right">
                      Aksi
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} data-testid={`dues-row-${item.id}`}>
                      <TableCell className="max-w-xs pl-[var(--space-6)]">
                        <Link
                          href={`/dues/${item.id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {item.name}
                        </Link>
                        {item.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums text-foreground">
                        {formatIdr(item.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="info" size="sm">
                          {DUES_BILLING_CYCLE_LABELS[item.billingCycle]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {DUES_TARGET_SCOPE_LABELS[item.targetScope]}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={item.isActive ? "success" : "outline"}
                          size="sm"
                        >
                          {item.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatJakartaDate(item.updatedAt)}
                      </TableCell>
                      <TableCell className="pr-[var(--space-6)] text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            nativeButton={false}
                            variant="outline"
                            size="sm"
                            render={<Link href={`/dues/${item.id}`} />}
                          >
                            <EyeIcon className="size-3.5" />
                            <span>Detail</span>
                          </Button>
                          {canManage && (
                            <>
                              <Button
                                nativeButton={false}
                                variant="secondary"
                                size="sm"
                                render={<Link href={`/dues/${item.id}/edit`} />}
                              >
                                <PencilIcon className="size-3.5" />
                                <span>Ubah</span>
                              </Button>
                              <DuesDeleteDialog
                                dueId={item.id}
                                dueName={item.name}
                                triggerSize="sm"
                              />
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 px-[var(--space-4)] md:hidden">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2.5 rounded-lg border border-border p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/dues/${item.id}`}
                        className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
                      >
                        {item.name}
                      </Link>
                      <p className="text-sm font-semibold tabular-nums text-primary">
                        {formatIdr(item.amount)}
                      </p>
                    </div>
                    <Badge
                      variant={item.isActive ? "success" : "outline"}
                      size="sm"
                    >
                      {item.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="info" size="sm">
                      {DUES_BILLING_CYCLE_LABELS[item.billingCycle]}
                    </Badge>
                    <span>{DUES_TARGET_SCOPE_LABELS[item.targetScope]}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                      render={<Link href={`/dues/${item.id}`} />}
                    >
                      Detail
                    </Button>
                    {canManage && (
                      <>
                        <Button
                          nativeButton={false}
                          variant="secondary"
                          size="sm"
                          render={<Link href={`/dues/${item.id}/edit`} />}
                        >
                          Ubah
                        </Button>
                        <DuesDeleteDialog
                          dueId={item.id}
                          dueName={item.name}
                          triggerSize="sm"
                        />
                      </>
                    )}
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
                        search: filters.search,
                        billingCycle: filters.billingCycle,
                        targetScope: filters.targetScope,
                        activeFilter: filters.activeFilter,
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
                        search: filters.search,
                        billingCycle: filters.billingCycle,
                        targetScope: filters.targetScope,
                        activeFilter: filters.activeFilter,
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

