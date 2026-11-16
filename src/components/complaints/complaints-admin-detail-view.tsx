"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CalendarClockIcon,
  HistoryIcon,
  InfoIcon,
  MessageSquareIcon,
  SendIcon,
  TagIcon,
  UserIcon,
} from "lucide-react"
import { toast } from "sonner"

import { ComplaintDeleteDialog } from "@/components/complaints/complaint-delete-dialog"
import { ComplaintPhotoViewer } from "@/components/complaints/complaint-photo-viewer"
import { ComplaintStatusTransitionDialog } from "@/components/complaints/complaint-status-transition-dialog"
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
import { Textarea } from "@/components/ui/textarea"
import type { RoleCode } from "@/lib/auth/types"
import {
  buildComplaintStatusHistoryDescription,
  formatComplaintDateTime,
  getAllowedNextComplaintStatuses,
  getComplaintPriorityBadgeVariant,
  getComplaintPriorityLabel,
  getComplaintRoleBannerNotice,
  getComplaintStatusBadgeVariant,
  getComplaintStatusLabel,
  getComplaintTransitionActionMeta,
} from "@/lib/complaints/formatters"
import {
  useAdminComplaintDetail,
  useCreateComplaintReplyMutation,
} from "@/lib/complaints/hooks"
import { createComplaintReplySchema } from "@/lib/complaints/schemas"
import type {
  ComplaintDetail,
  ComplaintTransitionTarget,
} from "@/lib/complaints/types"

interface ComplaintsAdminDetailViewProps {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  complaintId: string
  initialDetail: ComplaintDetail
}

export function ComplaintsAdminDetailView({
  tenantId,
  actorKey,
  roles,
  complaintId,
  initialDetail,
}: ComplaintsAdminDetailViewProps) {
  const detailQuery = useAdminComplaintDetail({
    tenantId,
    actorKey,
    complaintId,
    initialData: initialDetail,
  })
  const replyMutation = useCreateComplaintReplyMutation(tenantId)

  const detail = detailQuery.data ?? initialDetail
  const { complaint, replies, statusHistory, permissions } = detail

  const [replyText, setReplyText] = React.useState("")
  const [replyError, setReplyError] = React.useState<string | null>(null)
  const [pendingTransition, setPendingTransition] =
    React.useState<ComplaintTransitionTarget | null>(null)
  const [transitionDialogOpen, setTransitionDialogOpen] = React.useState(false)

  const allowedTransitions = permissions.canTransition
    ? getAllowedNextComplaintStatuses(complaint.status)
    : []

  const sortedReplies = React.useMemo(
    () =>
      [...replies].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [replies]
  )

  const sortedHistory = React.useMemo(
    () =>
      [...statusHistory].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    [statusHistory]
  )

  const roleNotice = getComplaintRoleBannerNotice(roles)
  const isClosed =
    complaint.status === "resolved" || complaint.status === "rejected"
  const isManagerRole = roles.some(
    (role) =>
      role === "ketua_rt" || role === "sekretaris" || role === "pengurus"
  )

  async function handleSubmitReply(event: React.FormEvent) {
    event.preventDefault()
    if (!permissions.canReply || replyMutation.isPending) return

    const trimmed = replyText.trim()
    const parsed = createComplaintReplySchema.safeParse({
      complaintId: complaint.id,
      message: trimmed,
    })

    if (!parsed.success) {
      setReplyError(
        parsed.error.issues[0]?.message ??
          "Pesan balasan wajib diisi minimal 2 karakter."
      )
      return
    }

    setReplyError(null)

    try {
      await replyMutation.mutateAsync({
        complaintId: complaint.id,
        message: trimmed,
        scope: "admin",
      })
      setReplyText("")
      toast.success("Balasan pengaduan berhasil dikirim")
    } catch (err) {
      setReplyError(
        err instanceof Error
          ? err.message
          : "Gagal mengirim balasan pengaduan. Silakan coba lagi."
      )
    }
  }

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/pengaduan" />}
            className="-ml-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Daftar Pengaduan</span>
          </Button>
        </div>

        <PageHeader
          title={complaint.title}
          description={`Dilaporkan oleh ${complaint.reporterLabel} pada ${formatComplaintDateTime(complaint.createdAt)}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {allowedTransitions.map((targetStatus) => {
                const meta = getComplaintTransitionActionMeta(targetStatus)
                return (
                  <Button
                    key={targetStatus}
                    type="button"
                    variant={meta.buttonVariant}
                    size="sm"
                    onClick={() => {
                      setPendingTransition(targetStatus)
                      setTransitionDialogOpen(true)
                    }}
                    data-testid={`open-transition-${targetStatus}`}
                  >
                    <span>{meta.buttonLabel}</span>
                  </Button>
                )
              })}

              {permissions.canSoftDelete && (
                <ComplaintDeleteDialog
                  tenantId={tenantId}
                  complaintId={complaint.id}
                  complaintTitle={complaint.title}
                  variant="destructive"
                  size="sm"
                />
              )}

              {permissions.isMetadataOnly && (
                <Badge variant="outline" size="default">
                  Mode Metadata (Bendahara)
                </Badge>
              )}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={getComplaintStatusBadgeVariant(complaint.status)}
            size="default"
            data-testid="complaint-detail-status-badge"
          >
            {getComplaintStatusLabel(complaint.status)}
          </Badge>
          <Badge
            variant={getComplaintPriorityBadgeVariant(complaint.priority)}
            size="default"
            data-testid="complaint-detail-priority-badge"
          >
            Prioritas {getComplaintPriorityLabel(complaint.priority)}
          </Badge>
          <Badge variant="outline" size="default">
            <TagIcon className="size-3" />
            <span>{complaint.category}</span>
          </Badge>
        </div>
      </div>

      {roleNotice && (
        <div
          data-testid="bendahara-detail-notice"
          className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>{roleNotice}</span>
        </div>
      )}

      {detailQuery.error instanceof Error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle/40 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{detailQuery.error.message}</span>
        </div>
      )}

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        {/* Main Column */}
        <div className="space-y-[var(--space-6)] lg:col-span-2">
          {/* Deskripsi & Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informasi Pengaduan</CardTitle>
              <CardDescription>
                Detail laporan yang disampaikan warga beserta metadata waktu.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
                  {complaint.description}
                </p>
              </div>

              <dl className="grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2">
                <div className="space-y-1">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <UserIcon className="size-3.5" />
                    <span>Pelapor</span>
                  </dt>
                  <dd className="font-medium text-foreground">
                    {complaint.reporterLabel}
                  </dd>
                </div>

                <div className="space-y-1">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <TagIcon className="size-3.5" />
                    <span>Kategori &amp; Prioritas</span>
                  </dt>
                  <dd className="font-medium text-foreground">
                    {complaint.category} •{" "}
                    {getComplaintPriorityLabel(complaint.priority)}
                  </dd>
                </div>

                <div className="space-y-1">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <CalendarClockIcon className="size-3.5" />
                    <span>Dibuat pada</span>
                  </dt>
                  <dd className="text-foreground">
                    {formatComplaintDateTime(complaint.createdAt)}
                  </dd>
                </div>

                <div className="space-y-1">
                  <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <CalendarClockIcon className="size-3.5" />
                    <span>Terakhir diperbarui</span>
                  </dt>
                  <dd className="text-foreground">
                    {formatComplaintDateTime(complaint.updatedAt)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Lampiran Foto */}
          <ComplaintPhotoViewer
            complaint={complaint}
            permissions={permissions}
          />

          {/* Thread Balasan */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareIcon className="size-4 text-muted-foreground" />
                <span>Percakapan &amp; Balasan</span>
              </CardTitle>
              <CardDescription>
                Komunikasi antara pengurus RT dan warga pelapor (hanya teks).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {sortedReplies.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                  Belum ada balasan pada pengaduan ini.
                </div>
              ) : (
                <div className="space-y-3" data-testid="complaint-replies-list">
                  {sortedReplies.map((reply) => (
                    <div
                      key={reply.id}
                      data-testid={`complaint-reply-${reply.id}`}
                      className={
                        reply.isStaffReply
                          ? "rounded-lg border border-primary/20 bg-primary-subtle/30 p-3.5"
                          : "rounded-lg border border-border bg-muted/30 p-3.5"
                      }
                    >
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {reply.authorLabel}
                          </span>
                          <Badge
                            variant={reply.isStaffReply ? "info" : "outline"}
                            size="sm"
                          >
                            {reply.isStaffReply ? "Pengurus" : "Pelapor"}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatComplaintDateTime(reply.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
                        {reply.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {permissions.canReply ? (
                <form
                  onSubmit={handleSubmitReply}
                  className="space-y-3 border-t border-border pt-4"
                  data-testid="complaint-reply-form"
                >
                  <div className="space-y-2">
                    <label
                      htmlFor="admin-complaint-reply"
                      className="text-sm font-medium text-foreground"
                    >
                      Kirim Balasan Pengurus
                    </label>
                    <Textarea
                      id="admin-complaint-reply"
                      value={replyText}
                      onChange={(event) => {
                        setReplyText(event.target.value)
                        if (replyError) setReplyError(null)
                      }}
                      placeholder="Tulis tanggapan atau informasi tindak lanjut untuk warga pelapor (2–1500 karakter)..."
                      maxLength={1500}
                      rows={3}
                      disabled={replyMutation.isPending}
                      aria-invalid={Boolean(replyError)}
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Balasan akan terlihat oleh warga pelapor pada portal
                        warga.
                      </span>
                      <span className="tabular-nums">
                        {replyText.trim().length}/1500
                      </span>
                    </div>
                  </div>

                  {replyError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
                    >
                      <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                      <span>{replyError}</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={replyMutation.isPending}
                      data-testid="submit-complaint-reply-btn"
                    >
                      <SendIcon className="size-3.5" />
                      <span>
                        {replyMutation.isPending
                          ? "Mengirim..."
                          : "Kirim Balasan"}
                      </span>
                    </Button>
                  </div>
                </form>
              ) : isManagerRole && isClosed ? (
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                  Pengaduan sudah berstatus{" "}
                  <strong>{getComplaintStatusLabel(complaint.status)}</strong>,
                  sehingga tidak dapat dibuka kembali atau ditambahkan balasan
                  baru.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Column: Status History */}
        <div className="space-y-[var(--space-6)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HistoryIcon className="size-4 text-muted-foreground" />
                <span>Riwayat Status</span>
              </CardTitle>
              <CardDescription>
                Jejak kronologis perubahan status pengaduan oleh pengurus.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sortedHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada catatan riwayat status.
                </p>
              ) : (
                <ol
                  className="space-y-4"
                  data-testid="complaint-status-history-list"
                >
                  {sortedHistory.map((item, idx) => (
                    <li
                      key={item.id}
                      className="relative pl-5 before:absolute before:top-2 before:left-1 before:size-2 before:rounded-full before:bg-primary"
                    >
                      {idx < sortedHistory.length - 1 && (
                        <span
                          aria-hidden="true"
                          className="absolute top-4 bottom-[-16px] left-[7px] w-px bg-border"
                        />
                      )}
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={getComplaintStatusBadgeVariant(
                              item.newStatus
                            )}
                            size="sm"
                          >
                            {getComplaintStatusLabel(item.newStatus)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatComplaintDateTime(item.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-foreground">
                          {buildComplaintStatusHistoryDescription({
                            previousStatus: item.previousStatus,
                            newStatus: item.newStatus,
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Oleh:{" "}
                          <span className="font-medium text-foreground">
                            {item.changedByLabel}
                          </span>
                        </p>
                        {item.reason && (
                          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs break-words whitespace-pre-wrap text-foreground">
                            {item.reason}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {permissions.canTransition && (
        <ComplaintStatusTransitionDialog
          tenantId={tenantId}
          complaintId={complaint.id}
          targetStatus={pendingTransition}
          open={transitionDialogOpen}
          onOpenChange={setTransitionDialogOpen}
        />
      )}
    </PageContainer>
  )
}
