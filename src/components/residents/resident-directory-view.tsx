"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HomeIcon,
  PhoneIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { HouseholdEditDialog } from "@/components/residents/household-edit-dialog"
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
import type { HouseholdOption } from "@/lib/residents/queries"
import {
  FAMILY_ROLE_LABELS,
  GENDER_LABELS,
  HOUSEHOLD_STATUS_LABELS,
  RESIDENCY_STATUS_LABELS,
  STAY_STATUS_LABELS,
  getHouseholdStatusBadgeVariant,
  getResidencyStatusBadgeVariant,
  type HouseholdSummary,
  type ResidentDirectoryItem,
  type ResidentSummary,
} from "@/lib/residents/types"

interface ResidentDirectoryViewProps {
  items: ResidentDirectoryItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  householdOptions: HouseholdOption[]
  selectedHousehold: HouseholdSummary | null
  selectedHouseholdMembers: ResidentSummary[]
  canManage: boolean
  filters: {
    search: string
    status: string
    householdId: string
  }
  error: string | null
  archivedNotice?: boolean
}

function buildDirectoryUrl(params: {
  search?: string
  status?: string
  householdId?: string
  page?: number
}): string {
  const qs = new URLSearchParams()
  if (params.search?.trim()) qs.set("q", params.search.trim())
  if (params.status && params.status !== "all") qs.set("status", params.status)
  if (params.householdId && params.householdId !== "all") {
    qs.set("householdId", params.householdId)
  }
  if (params.page && params.page > 1) qs.set("page", String(params.page))
  const serialized = qs.toString()
  return serialized ? `/residents?${serialized}` : "/residents"
}

export function ResidentDirectoryView({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  householdOptions,
  selectedHousehold,
  selectedHouseholdMembers,
  canManage,
  filters,
  error,
  archivedNotice = false,
}: ResidentDirectoryViewProps) {
  const router = useRouter()
  const [isNavigating, startTransition] = React.useTransition()
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const statusSelectRef = React.useRef<HTMLSelectElement>(null)
  const householdSelectRef = React.useRef<HTMLSelectElement>(null)

  const navigateWithFilters = (next: {
    search?: string
    status?: string
    householdId?: string
    page?: number
  }) => {
    const url = buildDirectoryUrl(next)
    startTransition(() => {
      router.push(url)
    })
  }

  const readCurrentFormValues = () => ({
    search: searchInputRef.current?.value ?? filters.search,
    status: statusSelectRef.current?.value ?? (filters.status || "all"),
    householdId:
      householdSelectRef.current?.value ?? (filters.householdId || "all"),
  })

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const current = readCurrentFormValues()
    navigateWithFilters({
      ...current,
      page: 1,
    })
  }

  const handleReset = () => {
    navigateWithFilters({ page: 1 })
  }

  const hasActiveFilters = Boolean(
    filters.search ||
      (filters.status && filters.status !== "all") ||
      (filters.householdId && filters.householdId !== "all")
  )

  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, totalCount)

  const headResident = selectedHousehold
    ? selectedHouseholdMembers.find(
        (m) => m.id === selectedHousehold.headResidentId
      ) ?? null
    : null

  return (
    <PageContainer>
      <PageHeader
        title="Direktori Warga & Kartu Keluarga"
        description="Kelola daftar warga aktif, keanggotaan keluarga, dan status domisili di lingkungan RT."
        actions={
          canManage ? (
            <Button
              nativeButton={false}
              render={<Link href="/residents/new" />}
            >
              <PlusIcon data-icon="inline-start" />
              Tambah Warga
            </Button>
          ) : (
            <Badge variant="outline" size="lg">
              Mode Lihat Saja
            </Badge>
          )
        }
      />

      {archivedNotice && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-sm text-success-text"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Data warga berhasil dinonaktifkan dan diarsipkan.</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive-border bg-destructive-subtle px-4 py-3 text-sm text-destructive-text"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <Card>
        <CardContent className="pt-6">
          <form
            key={`${filters.search}|${filters.status}|${filters.householdId}`}
            onSubmit={handleFilterSubmit}
            className="grid gap-3 md:grid-cols-12"
          >
            <div className="relative md:col-span-5">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="search"
                name="q"
                defaultValue={filters.search}
                placeholder="Cari nama warga, nomor HP, blok, atau alamat..."
                aria-label="Cari warga"
                className="pl-9"
              />
            </div>

            <div className="md:col-span-3">
              <select
                ref={statusSelectRef}
                name="status"
                aria-label="Filter status warga"
                defaultValue={filters.status || "all"}
                onChange={(e) => {
                  const current = readCurrentFormValues()
                  navigateWithFilters({
                    ...current,
                    status: e.target.value,
                    page: 1,
                  })
                }}
                className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              >
                <option value="all">Semua Status Warga</option>
                {Object.entries(RESIDENCY_STATUS_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>

            <div className="md:col-span-4">
              <select
                ref={householdSelectRef}
                name="householdId"
                aria-label="Filter Kartu Keluarga"
                defaultValue={filters.householdId || "all"}
                onChange={(e) => {
                  const current = readCurrentFormValues()
                  navigateWithFilters({
                    ...current,
                    householdId: e.target.value,
                    page: 1,
                  })
                }}
                className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              >
                <option value="all">Semua Kartu Keluarga / Rumah</option>
                {householdOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.blockUnit ? `${option.blockUnit} — ` : ""}
                    {option.address}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 md:col-span-12">
              <Button type="submit" size="sm" loading={isNavigating}>
                <SearchIcon data-icon="inline-start" />
                Terapkan Filter
              </Button>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={isNavigating}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Reset
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                Menampilkan {startIndex}–{endIndex} dari {totalCount} warga
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Selected Household Summary Card (shown when householdId filter active) */}
      {selectedHousehold && (
        <Card className="border-primary/25 bg-surface">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <HomeIcon className="size-4 text-primary" />
              <CardTitle className="text-base">
                {selectedHousehold.blockUnit
                  ? `Rumah ${selectedHousehold.blockUnit}`
                  : "Kartu Keluarga Terpilih"}
              </CardTitle>
              <Badge
                variant={getHouseholdStatusBadgeVariant(
                  selectedHousehold.status
                )}
                size="sm"
              >
                KK {HOUSEHOLD_STATUS_LABELS[selectedHousehold.status]}
              </Badge>
              <Badge variant="outline" size="sm">
                Hunian: {STAY_STATUS_LABELS[selectedHousehold.residenceStatus]}
              </Badge>
            </div>
            <CardDescription>{selectedHousehold.address}</CardDescription>
            {canManage && (
              <CardAction>
                <HouseholdEditDialog
                  household={selectedHousehold}
                  members={selectedHouseholdMembers}
                />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {canManage && (
              <span>
                No. KK:{" "}
                <strong className="font-mono text-foreground">
                  {selectedHousehold.kkNumber}
                </strong>
              </span>
            )}
            <span>
              Kepala Keluarga:{" "}
              <strong className="text-foreground">
                {headResident?.fullName ?? "Belum ditetapkan"}
              </strong>
            </span>
            <span>
              Total Anggota:{" "}
              <strong className="text-foreground">
                {selectedHouseholdMembers.length} orang
              </strong>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Directory Content */}
      <div className={isNavigating ? "opacity-60 transition-opacity" : ""}>
        {items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UsersIcon className="size-6" />
              </div>
              <h2 className="text-base font-semibold text-foreground">
                {hasActiveFilters
                  ? "Tidak ada warga yang sesuai"
                  : "Belum ada data warga"}
              </h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Coba ubah kata kunci pencarian atau reset filter status dan Kartu Keluarga."
                  : "Mulai daftarkan kartu keluarga dan anggota warga RT agar data kependudukan terkelola rapi."}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Reset Filter
                  </Button>
                )}
                {canManage && (
                  <Button
                    nativeButton={false}
                    size="sm"
                    render={<Link href="/residents/new" />}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Tambah Warga Pertama
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Desktop Table */}
            <Card className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Warga</TableHead>
                    <TableHead>Blok / Alamat</TableHead>
                    <TableHead>Peran Keluarga</TableHead>
                    <TableHead>Status Tinggal</TableHead>
                    <TableHead>Status Warga</TableHead>
                    <TableHead>No. HP</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const isHead =
                      item.household?.headResidentId === item.id ||
                      item.familyRole === "kepala_keluarga"
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <Link
                              href={`/residents/${item.id}`}
                              className="font-medium text-foreground hover:text-primary hover:underline"
                            >
                              {item.fullName}
                            </Link>
                            <span className="text-xs text-muted-foreground">
                              {GENDER_LABELS[item.gender]}
                              {isHead ? " • Kepala Keluarga" : ""}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex max-w-xs flex-col whitespace-normal">
                            <span className="font-medium text-foreground">
                              {item.household?.blockUnit ?? "-"}
                            </span>
                            <span className="line-clamp-1 text-xs text-muted-foreground">
                              {item.household?.address ?? "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" size="sm">
                            {FAMILY_ROLE_LABELS[item.familyRole]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {STAY_STATUS_LABELS[item.stayStatus]}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={getResidencyStatusBadgeVariant(
                              item.residencyStatus
                            )}
                            size="sm"
                          >
                            {RESIDENCY_STATUS_LABELS[item.residencyStatus]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.phone ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="xs"
                              nativeButton={false}
                              render={<Link href={`/residents/${item.id}`} />}
                            >
                              Detail
                            </Button>
                            {canManage && (
                              <Button
                                variant="ghost"
                                size="xs"
                                nativeButton={false}
                                render={
                                  <Link href={`/residents/${item.id}/edit`} />
                                }
                              >
                                Ubah
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>

            {/* Mobile Card List */}
            <div className="flex flex-col gap-3 md:hidden">
              {items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="flex flex-col gap-3 pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          href={`/residents/${item.id}`}
                          className="font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {item.fullName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {GENDER_LABELS[item.gender]} •{" "}
                          {FAMILY_ROLE_LABELS[item.familyRole]}
                        </p>
                      </div>
                      <Badge
                        variant={getResidencyStatusBadgeVariant(
                          item.residencyStatus
                        )}
                        size="sm"
                      >
                        {RESIDENCY_STATUS_LABELS[item.residencyStatus]}
                      </Badge>
                    </div>

                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <HomeIcon className="size-3.5 shrink-0" />
                        <span>
                          {item.household?.blockUnit
                            ? `${item.household.blockUnit} — `
                            : ""}
                          {item.household?.address ?? "-"}
                        </span>
                      </span>
                      {item.phone && (
                        <span className="flex items-center gap-1.5">
                          <PhoneIcon className="size-3.5 shrink-0" />
                          <span>{item.phone}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        nativeButton={false}
                        render={<Link href={`/residents/${item.id}`} />}
                      >
                        Lihat Detail
                      </Button>
                      {canManage && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          nativeButton={false}
                          render={<Link href={`/residents/${item.id}/edit`} />}
                        >
                          Ubah Data
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
                <span className="text-xs text-muted-foreground">
                  Halaman {page} dari {totalPages}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || isNavigating}
                    onClick={() =>
                      navigateWithFilters({
                        search: filters.search,
                        status: filters.status,
                        householdId: filters.householdId,
                        page: page - 1,
                      })
                    }
                  >
                    <ChevronLeftIcon data-icon="inline-start" />
                    Sebelumnya
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || isNavigating}
                    onClick={() =>
                      navigateWithFilters({
                        search: filters.search,
                        status: filters.status,
                        householdId: filters.householdId,
                        page: page + 1,
                      })
                    }
                  >
                    Berikutnya
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageContainer>
  )
}
