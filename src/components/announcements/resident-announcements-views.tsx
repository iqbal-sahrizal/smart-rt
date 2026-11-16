"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MegaphoneIcon,
} from "lucide-react"

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
import {
  RESIDENT_SAFE_TARGET_LABELS,
  getAnnouncementTargetBadgeVariant,
  type ResidentAnnouncementItem,
} from "@/lib/announcements/types"

function formatResidentDate(value: string | null): string {
  if (!value) return "Baru diterbitkan"
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value))
}

function buildExcerpt(content: string, maxLength = 180): string {
  const normalized = content.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

interface ResidentAnnouncementsFeedViewProps {
  tenantName: string
  items: ResidentAnnouncementItem[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  error: string | null
}

export function ResidentAnnouncementsFeedView({
  tenantName,
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  error,
}: ResidentAnnouncementsFeedViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  const goToPage = (nextPage: number) => {
    const href =
      nextPage > 1
        ? `/resident/announcements?page=${nextPage}`
        : "/resident/announcements"
    startTransition(() => {
      router.push(href)
    })
  }

  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const endIndex = Math.min(page * pageSize, totalCount)

  return (
    <ResidentContainer>
      <section className="flex flex-col justify-between gap-[var(--space-3)] sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Pengumuman Warga
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informasi resmi dan pemberitahuan terkini dari pengurus {tenantName}.
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
                Belum ada pengumuman untuk Anda
              </p>
              <p className="text-xs text-muted-foreground">
                Pengumuman resmi yang diterbitkan oleh pengurus RT akan tampil di
                halaman ini.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Menampilkan {startIndex}–{endIndex} dari {totalCount} pengumuman
            </span>
            {isPending && <span>Memuat halaman...</span>}
          </div>

          <div className="flex flex-col gap-[var(--space-4)]">
            {items.map((item) => (
              <Card key={item.id} data-testid={`resident-announcement-${item.id}`}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge
                      variant={getAnnouncementTargetBadgeVariant(
                        item.targetType
                      )}
                      size="sm"
                    >
                      {RESIDENT_SAFE_TARGET_LABELS[item.targetType]}
                    </Badge>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarIcon className="size-3.5" />
                      {formatResidentDate(item.publishedAt ?? item.createdAt)}
                    </span>
                  </div>
                  <CardTitle className="pt-1 text-base">
                    <Link
                      href={`/resident/announcements/${item.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {item.title}
                    </Link>
                  </CardTitle>
                  <CardDescription className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {buildExcerpt(item.content)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button
                    nativeButton={false}
                    variant="outline"
                    size="sm"
                    render={<Link href={`/resident/announcements/${item.id}`} />}
                  >
                    <span>Baca Selengkapnya</span>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border pt-[var(--space-4)]">
              <p className="text-xs text-muted-foreground">
                Halaman {page} dari {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isPending}
                  onClick={() => goToPage(page - 1)}
                >
                  <ChevronLeftIcon className="size-4" />
                  <span>Sebelumnya</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || isPending}
                  onClick={() => goToPage(page + 1)}
                >
                  <span>Berikutnya</span>
                  <ChevronRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </ResidentContainer>
  )
}

interface ResidentAnnouncementDetailViewProps {
  tenantName: string
  announcement: ResidentAnnouncementItem
}

export function ResidentAnnouncementDetailView({
  tenantName,
  announcement,
}: ResidentAnnouncementDetailViewProps) {
  return (
    <ResidentContainer>
      <section className="flex flex-col justify-between gap-[var(--space-3)] sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {announcement.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pengumuman resmi {tenantName}
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          render={<Link href="/resident/announcements" />}
        >
          <ArrowLeftIcon className="size-4" />
          <span>Semua Pengumuman</span>
        </Button>
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge
              variant={getAnnouncementTargetBadgeVariant(
                announcement.targetType
              )}
              size="sm"
            >
              {RESIDENT_SAFE_TARGET_LABELS[announcement.targetType]}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarIcon className="size-3.5" />
              {formatResidentDate(
                announcement.publishedAt ?? announcement.createdAt
              )}
            </span>
          </div>
          <CardTitle className="pt-2 text-lg">{announcement.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {announcement.content}
          </div>
        </CardContent>
      </Card>
    </ResidentContainer>
  )
}
