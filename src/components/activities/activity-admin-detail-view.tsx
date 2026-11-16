"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BanIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClockIcon,
  HistoryIcon,
  InfoIcon,
  MapPinIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"

import {
  ActivitySoftDeleteDialog,
  ActivityStatusTransitionDialog,
} from "@/components/activities/activity-dialogs"
import { ActivityDocumentPanel } from "@/components/activities/activity-document-panel"
import { ActivityParticipantsPanel } from "@/components/activities/activity-participants-panel"
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
import type { RoleCode } from "@/lib/auth/types"
import type {
  ActivityAuditHistoryItem,
  EligibleActivityResidentOption,
} from "@/lib/activities/admin-candidates"
import {
  formatActivityCategoryLabel,
  formatActivityDateTimeRange,
  formatActivityQuotaSummary,
  formatActivityStatusLabel,
} from "@/lib/activities/formatters"
import { useAdminActivityDetail } from "@/lib/activities/hooks"
import type {
  ActivityDetail,
  ActivityParticipantsPageResult,
  ActivityStatus,
} from "@/lib/activities/types"
import {
  formatJakartaDateTimeShort,
  getActivityCategoryBadgeVariant,
  getActivityStatusBadgeVariant,
  getAdminActivitiesRoleBanner,
} from "@/lib/activities/ui-helpers"

export function ActivityAdminDetailView({
  tenantId,
  actorKey,
  roles,
  activityId,
  initialDetail,
  initialParticipants,
  initialParticipantsError,
  eligibleResidents,
  activityHistory,
  notice = null,
}: {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  activityId: string
  initialDetail: ActivityDetail
  initialParticipants: ActivityParticipantsPageResult | null
  initialParticipantsError?: string | null
  eligibleResidents: readonly EligibleActivityResidentOption[]
  activityHistory: readonly ActivityAuditHistoryItem[]
  notice?: "locked_edit" | null
}) {
  const detailQuery = useAdminActivityDetail({
    tenantId,
    actorKey,
    activityId,
    initialData: initialDetail,
  })

  const detail = detailQuery.data ?? initialDetail
  const { activity, permissions } = detail
  const roleBanner = getAdminActivitiesRoleBanner(roles)

  const [transitionTarget, setTransitionTarget] = React.useState<
    Exclude<ActivityStatus, "scheduled"> | null
  >(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title={activity.title}
        description={formatActivityDateTimeRange(
          activity.startAt,
          activity.endAt
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/kegiatan" />}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Daftar Kegiatan</span>
            </Button>

            {permissions.canUpdateInfo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/kegiatan/${activity.id}/edit`} />}
              >
                <PencilIcon className="size-4" />
                <span>Ubah Informasi</span>
              </Button>
            )}

            {permissions.canStartActivity && (
              <Button
                type="button"
                size="sm"
                onClick={() => setTransitionTarget("ongoing")}
              >
                <PlayIcon className="size-4" />
                <span>Mulai Kegiatan</span>
              </Button>
            )}

            {permissions.canCompleteActivity && (
              <Button
                type="button"
                size="sm"
                onClick={() => setTransitionTarget("completed")}
              >
                <CheckCircle2Icon className="size-4" />
                <span>Selesaikan</span>
              </Button>
            )}

            {permissions.canCancelActivity && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-destructive-border text-destructive hover:bg-destructive-subtle/50"
                onClick={() => setTransitionTarget("cancelled")}
              >
                <BanIcon className="size-4" />
                <span>Batalkan</span>
              </Button>
            )}

            {permissions.canSoftDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2Icon className="size-4" />
                <span>Arsipkan</span>
              </Button>
            )}
          </div>
        }
      />

      {notice === "locked_edit" && (
        <div
          role="status"
          className="rounded-xl border border-warning-border bg-warning-subtle/40 px-4 py-3 text-sm text-foreground"
        >
          Informasi kegiatan dengan status Selesai, Dibatalkan, atau Diarsipkan
          tidak dapat diubah lagi.
        </div>
      )}

      {activity.deletedAt && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-subtle/40 px-4 py-3 text-sm text-foreground"
        >
          <ArchiveIcon className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <div>
            <p className="font-medium">Kegiatan Telah Diarsipkan</p>
            <p className="text-xs text-muted-foreground">
              Diarsipkan pada {formatJakartaDateTimeShort(activity.deletedAt)}.
              Kegiatan ini disembunyikan dari portal warga dan seluruh aksi
              perubahan dikunci.
            </p>
          </div>
        </div>
      )}

      {activity.status === "cancelled" && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-destructive-border bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive-text"
        >
          <BanIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Kegiatan Dibatalkan</p>
            <p className="text-xs">
              Alasan: {activity.cancellationReason ?? "Tidak dicantumkan"} (
              {formatJakartaDateTimeShort(activity.cancelledAt)})
            </p>
          </div>
        </div>
      )}

      {roleBanner && !activity.deletedAt && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-subtle/40 px-4 py-3 text-sm text-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="space-y-0.5">
            <p className="font-medium">{roleBanner.title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {roleBanner.description}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Core Details */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Detail Kegiatan</CardTitle>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={getActivityCategoryBadgeVariant(activity.category)}
                  >
                    {formatActivityCategoryLabel(activity.category)}
                  </Badge>
                  <Badge variant={getActivityStatusBadgeVariant(activity.status)}>
                    {formatActivityStatusLabel(activity.status)}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                {activity.description ?? (
                  <span className="italic text-muted-foreground">
                    Tidak ada deskripsi tambahan.
                  </span>
                )}
              </div>

              <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2">
                <div className="flex items-start gap-2.5">
                  <CalendarDaysIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Waktu Pelaksanaan
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {formatActivityDateTimeRange(
                        activity.startAt,
                        activity.endAt
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <MapPinIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Lokasi
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {activity.location}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <UsersIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Kapasitas &amp; Peserta Aktif
                    </p>
                    <p className="text-sm font-medium text-foreground tabular-nums">
                      {formatActivityQuotaSummary(
                        activity.activeParticipantCount,
                        activity.maxParticipants
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <ClockIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Pendaftaran Mandiri Warga
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {activity.allowSelfRegistration
                        ? "Dibuka"
                        : "Ditutup (Manual Pengurus)"}
                    </p>
                    {activity.registrationDeadline && (
                      <p className="text-xs text-muted-foreground">
                        Batas daftar:{" "}
                        {formatJakartaDateTimeShort(
                          activity.registrationDeadline
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documentation */}
          <ActivityDocumentPanel
            tenantId={tenantId}
            activityId={activity.id}
            documents={activity.documents}
            permissions={permissions}
          />

          {/* Participants */}
          <ActivityParticipantsPanel
            tenantId={tenantId}
            actorKey={actorKey}
            activityId={activity.id}
            maxParticipants={activity.maxParticipants}
            activeParticipantCount={activity.activeParticipantCount}
            permissions={permissions}
            eligibleResidents={eligibleResidents}
            initialData={initialParticipants}
            initialError={initialParticipantsError}
            showFullManagementLink
          />
        </div>

        {/* Right Column: Metadata & Activity History */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ringkasan Administrasi</CardTitle>
              <CardDescription>
                Catatan waktu pembuatan dan pembaruan kegiatan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Dibuat</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatJakartaDateTimeShort(activity.createdAt)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Diperbarui</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatJakartaDateTimeShort(activity.updatedAt)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Jumlah Berkas</span>
                <span className="font-medium text-foreground tabular-nums">
                  {activity.documentCount} berkas
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <HistoryIcon className="size-4 text-primary" />
                <span>Riwayat Aktivitas</span>
              </CardTitle>
              <CardDescription>
                Jejak perubahan jadwal, status, dan dokumentasi kegiatan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activityHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {roles.some((r) => r === "ketua_rt" || r === "sekretaris")
                    ? "Belum ada catatan riwayat perubahan tambahan."
                    : "Log audit lengkap hanya tersedia untuk Ketua RT dan Sekretaris."}
                </p>
              ) : (
                <ol className="space-y-3 border-l border-border pl-3">
                  {activityHistory.map((item) => (
                    <li key={item.id} className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">
                        {item.actionLabel}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.summary}
                      </p>
                      <p className="text-[11px] text-muted-foreground/80 tabular-nums">
                        {formatJakartaDateTimeShort(item.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ActivityStatusTransitionDialog
        tenantId={tenantId}
        activityId={activity.id}
        targetStatus={transitionTarget}
        open={transitionTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setTransitionTarget(null)
        }}
      />

      <ActivitySoftDeleteDialog
        tenantId={tenantId}
        activityId={activity.id}
        activityTitle={activity.title}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
    </PageContainer>
  )
}

