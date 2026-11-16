"use client"

import { EyeIcon, XCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  useDismissCommunityReportMutation,
  useModerateCommunityContentMutation,
} from "@/lib/community-feed/hooks"
import type { CommunityReportTargetType } from "@/lib/community-feed/types"

export function CommunityRestoreButton({
  tenantId,
  actorKey,
  targetType,
  targetId,
}: {
  tenantId: string
  actorKey: string
  targetType: CommunityReportTargetType
  targetId: string
}) {
  const moderateMutation = useModerateCommunityContentMutation(
    tenantId,
    actorKey
  )

  async function handleRestore() {
    try {
      await moderateMutation.mutateAsync({
        targetType,
        targetId,
        action: "restore",
        reason: null,
        reportId: null,
      })
      toast.success(
        targetType === "post"
          ? "Postingan berhasil dipulihkan"
          : "Komentar berhasil dipulihkan"
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Gagal memulihkan konten."
      )
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleRestore}
      disabled={moderateMutation.isPending}
    >
      <EyeIcon className="size-4" />
      <span>{moderateMutation.isPending ? "Memproses..." : "Pulihkan"}</span>
    </Button>
  )
}

export function CommunityDismissReportButton({
  tenantId,
  actorKey,
  reportId,
}: {
  tenantId: string
  actorKey: string
  reportId: string
}) {
  const dismissMutation = useDismissCommunityReportMutation(
    tenantId,
    actorKey
  )

  async function handleDismiss() {
    try {
      await dismissMutation.mutateAsync({
        reportId,
        resolutionNote: "Laporan ditinjau dan tidak memerlukan tindakan.",
      })
      toast.success("Laporan berhasil ditolak")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menolak laporan.")
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleDismiss}
      disabled={dismissMutation.isPending}
    >
      <XCircleIcon className="size-4" />
      <span>{dismissMutation.isPending ? "Memproses..." : "Tolak Laporan"}</span>
    </Button>
  )
}
