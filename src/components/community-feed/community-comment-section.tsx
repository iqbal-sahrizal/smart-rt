"use client"

import * as React from "react"
import { SendIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CommunityCommentItem } from "@/components/community-feed/community-comment-item"
import { MAX_COMMUNITY_COMMENT_LENGTH } from "@/lib/community-feed/constants"
import {
  useCreateCommunityCommentMutation,
  usePostComments,
} from "@/lib/community-feed/hooks"
import type { CommunityCommentItem as CommunityCommentItemData } from "@/lib/community-feed/types"

interface CommunityCommentSectionProps {
  tenantId: string
  actorKey: string
  postId: string
  previewComments: CommunityCommentItemData[]
  commentCount: number
}

export function CommunityCommentSection({
  tenantId,
  actorKey,
  postId,
  previewComments,
  commentCount,
}: CommunityCommentSectionProps) {
  const [expanded, setExpanded] = React.useState(false)
  const [draft, setDraft] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const commentsQuery = usePostComments({
    tenantId,
    actorKey,
    postId,
    enabled: expanded,
  })
  const createCommentMutation = useCreateCommunityCommentMutation(
    tenantId,
    actorKey
  )

  const expandedComments =
    commentsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const displayedComments = expanded ? expandedComments : previewComments
  const hasMore = commentsQuery.hasNextPage ?? false
  const hiddenCount = Math.max(0, commentCount - previewComments.length)

  async function handleSubmitComment(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || createCommentMutation.isPending) return

    try {
      await createCommentMutation.mutateAsync({ postId, content: trimmed })
      setDraft("")
      setError(null)
      if (!expanded) setExpanded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim komentar.")
    }
  }

  return (
    <div className="space-y-3">
      {!expanded && commentCount > previewComments.length && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-sm text-muted-foreground hover:text-foreground"
          data-testid="view-all-comments-btn"
        >
          Lihat semua {commentCount} komentar
        </button>
      )}

      {!expanded && hiddenCount === 0 && commentCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {commentCount} komentar
        </p>
      )}

      <div className="space-y-3">
        {displayedComments.map((comment) => (
          <CommunityCommentItem
            key={comment.id}
            tenantId={tenantId}
            actorKey={actorKey}
            postId={postId}
            comment={comment}
          />
        ))}
      </div>

      {expanded && commentsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Memuat komentar...</p>
      )}

      {expanded && hasMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => commentsQuery.fetchNextPage()}
          disabled={commentsQuery.isFetchingNextPage}
        >
          {commentsQuery.isFetchingNextPage
            ? "Memuat..."
            : "Muat komentar lainnya"}
        </Button>
      )}

      <form onSubmit={handleSubmitComment} className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tulis komentar..."
          maxLength={MAX_COMMUNITY_COMMENT_LENGTH}
          disabled={createCommentMutation.isPending}
          data-testid="comment-input"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!draft.trim() || createCommentMutation.isPending}
          aria-label="Kirim komentar"
          data-testid="submit-comment-btn"
        >
          <SendIcon className="size-4" />
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
