"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
  MapPinIcon,
  RefreshCwIcon,
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  ACTIVITY_ROSTER_REMOVAL_SEMANTICS_NOTE,
  formatActivityCategoryLabel,
  formatActivityDateTimeRange,
  formatActivityParticipantStatusLabel,
  formatActivityStatusLabel,
} from "@/lib/activities/formatters"
import { useResidentActivityHistory } from "@/lib/activities/hooks"
import type {
  ResidentActivityHistoryItem,
  ResidentActivityHistoryPageResult,
} from "@/lib/activities/types"
import {
  formatJakartaDateTimeShort,
  getActivityCategoryBadgeVariant,
  getActivityStatusBadgeVariant,
  getParticipantStatusBadgeVariant,
} from "@/lib/activities/ui-helpers"

type MyActivitiesTab = "all" | "active" | "cancelled" | "history"

function filterHistoryItem(
  item: ResidentActivityHistoryItem,
  tab: MyActivitiesTab
): boolean {
  if (tab === "all") return true
  if (tab === "cancelled") {
    return item.participant.rsvpStatus === "cancelled"
  }
  if (tab === "active") {
    return (
      (item.activity.status === "scheduled" ||
        item.activity.status === "ongoing") &&
      (item.participant.rsvpStatus === "invited" ||
        item.participant.rsvpStatus === "attending")
    )
  }
  return (
    item.activity.status === "completed" ||
    item.participant.rsvpStatus === "attended" ||
    item.participant.rsvpStatus === "absent"
  )
}

export function ResidentMyActivitiesView({
  tenantId,
  actorKey,
  initialPage,
  initialData,
  initialError,
}: {
  tenantId: string
  actorKey: string
  initialPage: number
  initialData: ResidentActivityHistoryPageResult | null
  initialError: string | null
}) {
  const [page, setPage] = React.useState(initialPage)
  const [tab, setTab] = React.useState<MyActivitiesTab>("all")

  const isInitialState = page === initialPage
  const query = useResidentActivityHistory({
    tenantId,
    actorKey,
    page,
    pageSize: 20,
    initialData: isInitialState ? (initialData ?? undefined) : undefined,
  })

  const data = query.data ?? (isInitialState ? initialData : null)
  const errorMessage =
    query.error?.message ?? (isInitialState ? initialError : null)

  const filteredItems = React.useMemo(
    () => (data?.items ?? []).filter((item) => filterHistoryItem(item, tab)),
    [data?.items, tab]
  )

  return (
    <ResidentContainer className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Kegiatan &amp; Riwayat Saya
          </h1>
          <p className="text-sm text-muted-foreground">
            Catatan pendaftaran, pembatalan mandiri, dan kehadiran Anda.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/resident/activities" />}
          className="h-10"
        >
          <ArrowLeftIcon className="size-4" />
          <span>Jelajahi Kegiatan</span>
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "Semua"],
            ["active", "Aktif / Mendatang"],
            ["cancelled", "Dibatalkan Mandiri"],
            ["history", "Selesai & Kehadiran"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={tab === key ? "default" : "outline"}
            onClick={() => setTab(key)}
            className="h-9"
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Content */}
      {query.isLoading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : errorMessage && !data ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertCircleIcon className="size-8 text-destructive" />
            <p className="text-sm text-destructive-text">{errorMessage}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => query.refetch()}
            >
              <RefreshCwIcon className="size-3.5" />
              <span>Muat Ulang</span>
            </Button>
          </CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <CalendarDaysIcon className="size-9 text-muted-foreground/60" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Belum ada riwayat pada kategori ini
              </p>
              <p className="text-xs text-muted-foreground">
                Daftar kegiatan warga di RT Anda untuk melihat catatan
                keikutsertaan di sini.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/resident/activities" />}
            >
              Lihat Daftar Kegiatan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredItems.map(({ participant, activity }) => (
            <Card key={participant.participantId}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={getActivityCategoryBadgeVariant(activity.category)}
                    size="sm"
                  >
                    {formatActivityCategoryLabel(activity.category)}
                  </Badge>
                  <Badge
                    variant={getActivityStatusBadgeVariant(activity.status)}
                    size="sm"
                  >
                    Kegiatan: {formatActivityStatusLabel(activity.status)}
                  </Badge>
                  <Badge
                    variant={getParticipantStatusBadgeVariant(
                      participant.rsvpStatus
                    )}
                    size="sm"
                  >
                    {formatActivityParticipantStatusLabel(
                      participant.rsvpStatus
                    )}
                  </Badge>
                </div>
                <CardTitle className="pt-1 text-base">
                  <Link
                    href={`/resident/activities/${activity.id}`}
                    className="hover:text-primary hover:underline"
                  >
                    {activity.title}
                  </Link>
                </CardTitle>
                <CardDescription className="text-xs">
                  Terdaftar: {formatJakartaDateTimeShort(participant.registeredAt)}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-2.5 pt-0 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 text-foreground">
                  <CalendarDaysIcon className="size-3.5 shrink-0 text-primary" />
                  <span>
                    {formatActivityDateTimeRange(
                      activity.startAt,
                      activity.endAt
                    )}
                  </span>
                </p>
                <p className="flex items-center gap-1.5">
                  <MapPinIcon className="size-3.5 shrink-0" />
                  <span>{activity.location}</span>
                </p>

                {participant.registrationNotes && (
                  <p>
                    Catatan Anda:{" "}
                    <span className="text-foreground">
                      {participant.registrationNotes}
                    </span>
                  </p>
                )}

                {participant.rsvpStatus === "cancelled" && (
                  <p className="text-foreground">
                    Dibatalkan pada{" "}
                    {formatJakartaDateTimeShort(participant.cancelledAt)}
                    {participant.cancellationReason
                      ? ` (${participant.cancellationReason})`
                      : ""}
                  </p>
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full justify-between"
                  nativeButton={false}
                  render={<Link href={`/resident/activities/${activity.id}`} />}
                >
                  <span>Buka Detail Kegiatan</span>
                  <ChevronRightIcon className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
              <span>
                Halaman {data.page} dari {data.totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={data.page <= 1 || query.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeftIcon className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={data.page >= data.totalPages || query.isFetching}
                  onClick={() =>
                    setPage((p) => Math.min(data.totalPages, p + 1))
                  }
                >
                  <ChevronRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Privacy & Semantics Note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/20 p-3.5 text-xs leading-relaxed text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Halaman ini hanya memuat catatan keikutsertaan milik Anda pribadi.
          Pembatalan mandiri tetap tersimpan dengan status{" "}
          <strong className="text-foreground">Dibatalkan Mandiri</strong> dan
          dibedakan dari presensi{" "}
          <strong className="text-foreground">Hadir / Tidak Hadir</strong>.{" "}
          {ACTIVITY_ROSTER_REMOVAL_SEMANTICS_NOTE}
        </p>
      </div>
    </ResidentContainer>
  )
}

