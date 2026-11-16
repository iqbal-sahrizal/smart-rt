import Link from "next/link"
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircle2Icon,
  PencilIcon,
  UsersIcon,
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
import {
  ANNOUNCEMENT_STATUS_LABELS,
  ANNOUNCEMENT_TARGET_LABELS,
  getAnnouncementStatusBadgeVariant,
  getAnnouncementTargetBadgeVariant,
  type AnnouncementRecipientSummary,
  type AnnouncementSummary,
} from "@/lib/announcements/types"

interface AnnouncementDetailViewProps {
  announcement: AnnouncementSummary
  recipients: AnnouncementRecipientSummary[]
  canManage: boolean
  notice?: "created" | "updated" | "readonly" | null
}

function formatDateTime(value: string | null): string {
  if (!value) return "Belum dipublikasikan"
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function AnnouncementDetailView({
  announcement,
  recipients,
  canManage,
  notice = null,
}: AnnouncementDetailViewProps) {
  return (
    <PageContainer>
      <PageHeader
        title={announcement.title}
        description="Detail pengumuman RT dan cakupan penerima."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/announcements" />}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Kembali ke Daftar</span>
            </Button>
            {canManage && (
              <>
                <Button
                  nativeButton={false}
                  variant="secondary"
                  render={
                    <Link href={`/announcements/${announcement.id}/edit`} />
                  }
                  data-testid="edit-announcement-btn"
                >
                  <PencilIcon className="size-4" />
                  <span>Ubah</span>
                </Button>
                <AnnouncementDeleteDialog
                  announcementId={announcement.id}
                  announcementTitle={announcement.title}
                  hasAttachment={Boolean(announcement.attachmentPath)}
                />
              </>
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
          <span>Pengumuman baru berhasil disimpan.</span>
        </div>
      )}

      {notice === "updated" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Perubahan pengumuman berhasil disimpan.</span>
        </div>
      )}

      {notice === "readonly" && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          Peran Bendahara hanya dapat melihat detail pengumuman dan tidak
          memiliki izin untuk menyunting pengumuman.
        </div>
      )}

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={getAnnouncementStatusBadgeVariant(announcement.status)}
              >
                {ANNOUNCEMENT_STATUS_LABELS[announcement.status]}
              </Badge>
              <Badge
                variant={getAnnouncementTargetBadgeVariant(
                  announcement.targetType
                )}
              >
                {ANNOUNCEMENT_TARGET_LABELS[announcement.targetType]}
              </Badge>
            </div>
            <CardTitle className="pt-2 text-lg">{announcement.title}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-3.5" />
                Publikasi: {formatDateTime(announcement.publishedAt)}
              </span>
              <span>
                Diperbarui: {formatDateTime(announcement.updatedAt)}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {announcement.content}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="size-4 text-muted-foreground" />
              <span>Cakupan Penerima</span>
            </CardTitle>
            <CardDescription>
              {ANNOUNCEMENT_TARGET_LABELS[announcement.targetType]}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {announcement.targetType === "all" ? (
              <p className="text-sm text-muted-foreground">
                Pengumuman ini ditujukan untuk seluruh anggota aktif di RT Anda
                saat berstatus Dipublikasikan.
              </p>
            ) : recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada penerima spesifik yang terdaftar.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recipients.map((recipient) => (
                  <li
                    key={recipient.id}
                    className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground"
                  >
                    {recipient.roleName
                      ? recipient.roleName
                      : recipient.householdLabel ?? "Kartu Keluarga"}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>Dibuat: {formatDateTime(announcement.createdAt)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

