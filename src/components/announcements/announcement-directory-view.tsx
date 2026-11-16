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
  MegaphoneIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react"

import { AnnouncementDeleteDialog } from "@/components/announcements/announcement-delete-dialog"
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
  ANNOUNCEMENT_STATUS_LABELS,
  ANNOUNCEMENT_TARGET_LABELS,
  getAnnouncementStatusBadgeVariant,
  getAnnouncementTargetBadgeVariant,
  type AnnouncementSummary,
} from "@/lib/announcements/types"

interface AnnouncementDirectoryViewProps {
  items: AnnouncementSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  canManage: boolean
  filters: {
    search: string
    status: string
    targetType: string
  }
  error: string | null
  deletedNotice?: boolean
}

function formatAnnouncementDate(value: string | null): string {
  if (!value) return "Belum dipublikasikan"
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function buildDirectoryUrl(params: {
  search?: string
  status?: string
  targetType?: string
  page?: number
}): string {
  const qs = new URLSearchParams()
  if (params.search?.trim()) qs.set("q", params.search.trim())
  if (params.status && params.status !== "all") qs.set("status", params.status)
  if (params.targetType && params.targetType !== "all") {
    qs.set("targetType", params.targetType)
  }
  if (params.page && params.page > 1) qs.set("page", String(params.page))
  const serialized = qs.toString()
  return serialized ? `/announcements?${serialized}` : "/announcements"
}

function buildExcerpt(content: string, maxLength = 96): string {
  const normalized = content.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

export function AnnouncementDirectoryView({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  canManage,
  filters,
  error,
  deletedNotice = false,
}: AnnouncementDirectoryViewProps) {
  const router = useRouter()
  const [isNavigating, startTransition] = React.useTransition()
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const statusSelectRef = React.useRef<HTMLSelectElement>(null)
  const targetTypeSelectRef = React.useRef<HTMLSelectElement>(null)

  const navigateWithFilters = (next: {
    search?: string
    status?: string
    targetType?: string
    page?: number
  }) => {
    const url = buildDirectoryUrl(next)
    startTransition(() => {
      router.push(url)
    })
  }

  const handleFilterSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigateWithFilters({
      search: searchInputRef.current?.value ?? filters.search,
      status: statusSelectRef.current?.value ?? filters.status,
      targetType: targetTypeSelectRef.current?.value ?? filters.targetType,
      page: 1,
    })
  }

  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.status !== "all" ||
    filters.targetType !== "all"

  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, totalCount)

  return (
    <PageContainer>
      <PageHeader
        title="Pengumuman RT"
        description="Kelola informasi resmi, jadwal kegiatan, dan pemberitahuan untuk warga RT Anda."
        actions={
          canManage ? (
            <Button
              nativeButton={false}
              render={<Link href="/announcements/new" />}
              data-testid="create-announcement-btn"
            >
              <PlusIcon className="size-4" />
              <span>Buat Pengumuman</span>
            </Button>
          ) : (
            <Badge variant="outline" size="default">
              Mode Baca (Bendahara)
            </Badge>
          )
        }
      />

      {deletedNotice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Pengumuman berhasil dihapus dari daftar aktif.</span>
        </div>
      )}

      {!canManage && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Peran Anda memiliki akses baca saja untuk modul pengumuman. Pembuatan,
          penyuntingan, dan penghapusan hanya dapat dilakukan oleh Ketua RT,
          Sekretaris, atau Pengurus.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cari &amp; Filter Pengumuman</CardTitle>
          <CardDescription>
            Saring berdasarkan judul, isi, status publikasi, atau target audiens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            key={`${filters.search}|${filters.status}|${filters.targetType}`}
            onSubmit={handleFilterSubmit}
            className="flex flex-col gap-[var(--space-3)] md:flex-row md:items-center"
          >
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                name="q"
                defaultValue={filters.search}
                placeholder="Cari judul atau isi pengumuman..."
                className="pl-9"
              />
            </div>

            <select
              ref={statusSelectRef}
              name="status"
              aria-label="Filter status"
              defaultValue={filters.status}
              onChange={(event) =>
                navigateWithFilters({
                  search: searchInputRef.current?.value ?? filters.search,
                  status: event.target.value,
                  targetType:
                    targetTypeSelectRef.current?.value ?? filters.targetType,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Status</option>
              <option value="draft">Draf</option>
              <option value="published">Dipublikasikan</option>
              <option value="archived">Diarsipkan</option>
            </select>

            <select
              ref={targetTypeSelectRef}
              name="targetType"
              aria-label="Filter target audiens"
              defaultValue={filters.targetType}
              onChange={(event) =>
                navigateWithFilters({
                  search: searchInputRef.current?.value ?? filters.search,
                  status: statusSelectRef.current?.value ?? filters.status,
                  targetType: event.target.value,
                  page: 1,
                })
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              <option value="all">Semua Target</option>
              <option value="role">Peran Tertentu</option>
              <option value="household">Kartu Keluarga Tertentu</option>
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
            <MegaphoneIcon className="size-10 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                {hasActiveFilters
                  ? "Tidak ada pengumuman yang cocok dengan filter"
                  : "Belum ada pengumuman RT"}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasActiveFilters
                  ? "Coba ubah kata kunci pencarian atau reset filter."
                  : canManage
                    ? "Buat pengumuman pertama untuk disampaikan kepada warga."
                    : "Pengurus RT belum menerbitkan pengumuman."}
              </p>
            </div>
            {canManage && !hasActiveFilters && (
              <Button
                nativeButton={false}
                size="sm"
                render={<Link href="/announcements/new" />}
              >
                <PlusIcon className="size-4" />
                <span>Buat Pengumuman</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Daftar Pengumuman</CardTitle>
              <CardDescription>
                Menampilkan {startIndex}–{endIndex} dari {totalCount} pengumuman
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
                    <TableHead className="pl-[var(--space-6)]">Judul</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Waktu Publikasi / Pembaruan</TableHead>
                    <TableHead className="pr-[var(--space-6)] text-right">
                      Aksi
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} data-testid={`announcement-row-${item.id}`}>
                      <TableCell className="max-w-md pl-[var(--space-6)]">
                        <Link
                          href={`/announcements/${item.id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {item.title}
                        </Link>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {buildExcerpt(item.content)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getAnnouncementStatusBadgeVariant(item.status)}
                          size="sm"
                        >
                          {ANNOUNCEMENT_STATUS_LABELS[item.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getAnnouncementTargetBadgeVariant(item.targetType)}
                          size="sm"
                        >
                          {ANNOUNCEMENT_TARGET_LABELS[item.targetType]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.publishedAt
                          ? formatAnnouncementDate(item.publishedAt)
                          : `Diperbarui ${formatAnnouncementDate(item.updatedAt)}`}
                      </TableCell>
                      <TableCell className="pr-[var(--space-6)] text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Button
                            nativeButton={false}
                            variant="outline"
                            size="sm"
                            render={<Link href={`/announcements/${item.id}`} />}
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
                                render={
                                  <Link href={`/announcements/${item.id}/edit`} />
                                }
                              >
                                <PencilIcon className="size-3.5" />
                                <span>Ubah</span>
                              </Button>
                              <AnnouncementDeleteDialog
                                announcementId={item.id}
                                announcementTitle={item.title}
                                hasAttachment={Boolean(item.attachmentPath)}
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
                    <Link
                      href={`/announcements/${item.id}`}
                      className="text-sm font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {item.title}
                    </Link>
                    <Badge
                      variant={getAnnouncementStatusBadgeVariant(item.status)}
                      size="sm"
                    >
                      {ANNOUNCEMENT_STATUS_LABELS[item.status]}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {buildExcerpt(item.content, 120)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge
                      variant={getAnnouncementTargetBadgeVariant(item.targetType)}
                      size="sm"
                    >
                      {ANNOUNCEMENT_TARGET_LABELS[item.targetType]}
                    </Badge>
                    <span>
                      {item.publishedAt
                        ? formatAnnouncementDate(item.publishedAt)
                        : formatAnnouncementDate(item.updatedAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      nativeButton={false}
                      variant="outline"
                      size="sm"
                      render={<Link href={`/announcements/${item.id}`} />}
                    >
                      Detail
                    </Button>
                    {canManage && (
                      <>
                        <Button
                          nativeButton={false}
                          variant="secondary"
                          size="sm"
                          render={<Link href={`/announcements/${item.id}/edit`} />}
                        >
                          Ubah
                        </Button>
                        <AnnouncementDeleteDialog
                          announcementId={item.id}
                          announcementTitle={item.title}
                          hasAttachment={Boolean(item.attachmentPath)}
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
                        status: filters.status,
                        targetType: filters.targetType,
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
                        status: filters.status,
                        targetType: filters.targetType,
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
