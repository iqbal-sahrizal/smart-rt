"use client"

import { AlertCircleIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CommunityModerateHideDialog } from "@/components/community-feed/community-moderate-hide-dialog"
import {
  CommunityDismissReportButton,
  CommunityRestoreButton,
} from "@/components/community-feed/community-moderate-row-actions"
import { AdminCommunityModerationSkeleton } from "@/components/community-feed/community-feed-skeletons"
import { COMMUNITY_REPORT_CATEGORY_LABELS } from "@/lib/community-feed/constants"
import { formatCommunityTimeAgo } from "@/lib/community-feed/formatters"
import { useAdminModerationDashboard } from "@/lib/community-feed/hooks"
import type { CommunityModerationDashboardData } from "@/lib/community-feed/types"

interface AdminCommunityModerationViewProps {
  tenantId: string
  actorKey: string
  initialData: CommunityModerationDashboardData | null
  initialError: string | null
}

export function AdminCommunityModerationView({
  tenantId,
  actorKey,
  initialData,
  initialError,
}: AdminCommunityModerationViewProps) {
  const dashboardQuery = useAdminModerationDashboard({
    tenantId,
    actorKey,
    initialData: initialData ?? undefined,
  })

  if (dashboardQuery.isLoading && !dashboardQuery.data) {
    return <AdminCommunityModerationSkeleton />
  }

  const data = dashboardQuery.data
  const errorMessage = dashboardQuery.error?.message ?? initialError

  if (!data) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive"
      >
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="flex-1">
          <p>{errorMessage ?? "Gagal memuat modul moderasi feed komunitas."}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => dashboardQuery.refetch()}
          >
            <RefreshCwIcon className="size-3.5" />
            <span>Coba Lagi</span>
          </Button>
        </div>
      </div>
    )
  }

  const pendingReports = data.reports.filter((r) => r.status === "pending")

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">
          Moderasi Feed Komunitas
        </h1>
        {data.pendingReportCount > 0 && (
          <Badge variant="warning">{data.pendingReportCount} Menunggu</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Tinjau laporan warga dan kelola konten feed komunitas RT ini.
      </p>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">
            Laporan ({pendingReports.length})
          </TabsTrigger>
          <TabsTrigger value="posts">
            Semua Postingan ({data.posts.length})
          </TabsTrigger>
          <TabsTrigger value="audit">Riwayat Moderasi</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-3 pt-3">
          {pendingReports.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
              <ShieldAlertIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Tidak ada laporan yang menunggu peninjauan.
              </p>
            </div>
          ) : (
            pendingReports.map((report) => (
              <Card key={report.id}>
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                  <div>
                    <CardTitle className="text-sm">
                      Laporan {report.targetType === "post" ? "Postingan" : "Komentar"}{" "}
                      milik {report.targetPreview.authorName}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Dilaporkan oleh {report.reporterName} ·{" "}
                      {formatCommunityTimeAgo(report.createdAt)}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {COMMUNITY_REPORT_CATEGORY_LABELS[report.reasonCategory]}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!report.targetPreview.exists ? (
                    <p className="text-sm text-muted-foreground italic">
                      Konten telah dihapus oleh penulis.
                    </p>
                  ) : (
                    <p className="line-clamp-3 text-sm text-foreground">
                      {report.targetPreview.contentText || "(tidak ada teks)"}
                    </p>
                  )}
                  {report.reasonDetail && (
                    <p className="text-xs text-muted-foreground">
                      Detail laporan: {report.reasonDetail}
                    </p>
                  )}
                  {report.targetPreview.exists && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <CommunityModerateHideDialog
                        tenantId={tenantId}
                        actorKey={actorKey}
                        targetType={report.targetType}
                        targetId={
                          report.targetType === "post"
                            ? (report.postId as string)
                            : (report.commentId as string)
                        }
                        reportId={report.id}
                      />
                      <CommunityDismissReportButton
                        tenantId={tenantId}
                        actorKey={actorKey}
                        reportId={report.id}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="posts" className="space-y-3 pt-3">
          {data.posts.map((post) => (
            <Card key={post.id}>
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-sm">{post.author.displayName}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {formatCommunityTimeAgo(post.createdAt)} ·{" "}
                    {post.likeCount} suka · {post.commentCount} komentar
                  </p>
                </div>
                <Badge
                  variant={
                    post.moderationStatus === "published" ? "success" : "destructive"
                  }
                >
                  {post.moderationStatus === "published"
                    ? "Dipublikasikan"
                    : "Disembunyikan"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="line-clamp-2 text-sm text-foreground">
                  {post.caption || "(tanpa keterangan)"}
                </p>
                {post.moderationReason && (
                  <p className="text-xs text-muted-foreground">
                    Alasan moderasi: {post.moderationReason}
                  </p>
                )}
                {post.pendingReportCount > 0 && (
                  <Badge variant="warning" size="sm">
                    {post.pendingReportCount} laporan menunggu
                  </Badge>
                )}
                <div className="flex gap-2 pt-1">
                  {post.moderationStatus === "published" ? (
                    <CommunityModerateHideDialog
                      tenantId={tenantId}
                      actorKey={actorKey}
                      targetType="post"
                      targetId={post.id}
                    />
                  ) : (
                    <CommunityRestoreButton
                      tenantId={tenantId}
                      actorKey={actorKey}
                      targetType="post"
                      targetId={post.id}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="audit" className="space-y-2 pt-3">
          {data.auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada riwayat tindakan moderasi.
            </p>
          ) : (
            data.auditLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{log.action}</p>
                  <p className="text-xs text-muted-foreground">
                    oleh {log.actorName}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatCommunityTimeAgo(log.createdAt)}
                </span>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
