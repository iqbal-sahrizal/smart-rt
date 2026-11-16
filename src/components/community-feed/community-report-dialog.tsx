"use client"

import * as React from "react"
import { AlertCircleIcon, FlagIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  COMMUNITY_REPORT_CATEGORIES,
  COMMUNITY_REPORT_CATEGORY_LABELS,
} from "@/lib/community-feed/constants"
import { useReportCommunityContentMutation } from "@/lib/community-feed/hooks"
import type { CommunityReportCategory } from "@/lib/community-feed/types"

interface CommunityReportDialogProps {
  tenantId: string
  actorKey: string
  targetType: "post" | "comment"
  targetId: string
  trigger?: React.ReactElement
}

export function CommunityReportDialog({
  tenantId,
  actorKey,
  targetType,
  targetId,
  trigger,
}: CommunityReportDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [category, setCategory] = React.useState<CommunityReportCategory>(
    COMMUNITY_REPORT_CATEGORIES[0]
  )
  const [detail, setDetail] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const reportMutation = useReportCommunityContentMutation(tenantId, actorKey)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (reportMutation.isPending) return
    setError(null)

    try {
      await reportMutation.mutateAsync({
        targetType,
        targetId,
        reasonCategory: category,
        reasonDetail: detail.trim() || null,
      })
      setOpen(false)
      setDetail("")
      toast.success("Laporan terkirim. Pengurus RT akan meninjau konten ini.")
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal mengirim laporan."
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (reportMutation.isPending) return
        setOpen(next)
        if (!next) {
          setError(null)
        }
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <FlagIcon className="size-4" />
              <span>Laporkan</span>
            </Button>
          )
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              Laporkan {targetType === "post" ? "Postingan" : "Komentar"}
            </DialogTitle>
            <DialogDescription>
              Laporan akan ditinjau oleh Ketua RT, Sekretaris, atau Pengurus.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Alasan <span className="text-destructive">*</span>
            </label>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as CommunityReportCategory)
              }
              disabled={reportMutation.isPending}
              className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            >
              {COMMUNITY_REPORT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {COMMUNITY_REPORT_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Detail Tambahan (Opsional)
            </label>
            <Textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder="Jelaskan lebih lanjut mengenai konten ini..."
              maxLength={500}
              rows={3}
              disabled={reportMutation.isPending}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={reportMutation.isPending}
                >
                  Batal
                </Button>
              }
            />
            <Button type="submit" variant="destructive" disabled={reportMutation.isPending}>
              {reportMutation.isPending ? "Mengirim..." : "Kirim Laporan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
