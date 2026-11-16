"use client"

import * as React from "react"
import { CheckIcon, MoreHorizontalIcon, XIcon } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { CommunityReportDialog } from "@/components/community-feed/community-report-dialog"
import { formatCommunityTimeAgo } from "@/lib/community-feed/formatters"
import {
  useSoftDeleteCommunityCommentMutation,
  useUpdateCommunityCommentMutation,
} from "@/lib/community-feed/hooks"
import type { CommunityCommentItem as CommunityCommentItemData } from "@/lib/community-feed/types"

interface CommunityCommentItemProps {
  tenantId: string
  actorKey: string
  postId: string
  comment: CommunityCommentItemData
}

export function CommunityCommentItem({
  tenantId,
  actorKey,
  postId,
  comment,
}: CommunityCommentItemProps) {
  const [isEditing, setIsEditing] = React.useState(false)
  const [editValue, setEditValue] = React.useState(comment.content)
  const [error, setError] = React.useState<string | null>(null)

  const updateMutation = useUpdateCommunityCommentMutation(
    tenantId,
    actorKey,
    postId
  )
  const deleteMutation = useSoftDeleteCommunityCommentMutation(
    tenantId,
    actorKey,
    postId
  )

  async function handleSaveEdit() {
    const trimmed = editValue.trim()
    if (!trimmed) {
      setError("Komentar tidak boleh kosong.")
      return
    }
    try {
      await updateMutation.mutateAsync({
        commentId: comment.id,
        content: trimmed,
      })
      setIsEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan komentar.")
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ commentId: comment.id })
    } catch {
      // surfaced via mutation state only; comment list stays intact on failure
    }
  }

  return (
    <div className="flex gap-2.5" data-testid="comment-item">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback>{comment.author.initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">
              {comment.author.displayName}
            </span>
            {comment.author.staffBadge && (
              <span className="rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {comment.author.staffBadge}
              </span>
            )}
          </div>
          {isEditing ? (
            <div className="mt-1 space-y-2">
              <Textarea
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                rows={2}
                maxLength={1000}
                disabled={updateMutation.isPending}
                autoFocus
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                >
                  <CheckIcon className="size-3.5" />
                  <span>Simpan</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsEditing(false)
                    setEditValue(comment.content)
                    setError(null)
                  }}
                  disabled={updateMutation.isPending}
                >
                  <XIcon className="size-3.5" />
                  <span>Batal</span>
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 text-sm whitespace-pre-wrap text-foreground">
              {comment.content}
            </p>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 px-1 text-xs text-muted-foreground">
          <span>{formatCommunityTimeAgo(comment.createdAt)}</span>
          {comment.isEdited && <span>Diedit</span>}
        </div>
      </div>

      {!isEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground"
                aria-label="Opsi komentar"
              >
                <MoreHorizontalIcon className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {comment.isOwnComment ? (
              <>
                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                  Ubah Komentar
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  Hapus Komentar
                </DropdownMenuItem>
              </>
            ) : (
              <CommunityReportDialog
                tenantId={tenantId}
                actorKey={actorKey}
                targetType="comment"
                targetId={comment.id}
                trigger={
                  <DropdownMenuItem closeOnClick={false}>
                    Laporkan Komentar
                  </DropdownMenuItem>
                }
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
