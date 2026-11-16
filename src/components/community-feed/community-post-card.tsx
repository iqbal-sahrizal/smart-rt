"use client"

import * as React from "react"
import { HeartIcon, MessageCircleIcon, MoreHorizontalIcon } from "lucide-react"
import { cn } from "cn"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CommunityCommentSection } from "@/components/community-feed/community-comment-section"
import { CommunityPostComposerDialog } from "@/components/community-feed/community-post-composer-dialog"
import { CommunityPostDeleteDialog } from "@/components/community-feed/community-post-delete-dialog"
import { CommunityReportDialog } from "@/components/community-feed/community-report-dialog"
import {
  formatCommunityCount,
  formatCommunityTimeAgo,
} from "@/lib/community-feed/formatters"
import { useToggleCommunityPostLikeMutation } from "@/lib/community-feed/hooks"
import type { CommunityPostItem } from "@/lib/community-feed/types"

interface CommunityPostCardProps {
  tenantId: string
  actorKey: string
  post: CommunityPostItem
}

export function CommunityPostCard({
  tenantId,
  actorKey,
  post,
}: CommunityPostCardProps) {
  const toggleLikeMutation = useToggleCommunityPostLikeMutation(
    tenantId,
    actorKey
  )

  function handleToggleLike() {
    toggleLikeMutation.mutate({
      postId: post.id,
      desiredLiked: !post.likedByMe,
    })
  }

  return (
    <Card data-testid="community-post-card" data-post-id={post.id}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{post.author.initials}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground">
                {post.author.displayName}
              </span>
              {post.author.staffBadge && (
                <span className="rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {post.author.staffBadge}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCommunityTimeAgo(post.createdAt)}
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label="Opsi postingan"
              >
                <MoreHorizontalIcon className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {post.isOwnPost ? (
              <>
                <CommunityPostComposerDialog
                  tenantId={tenantId}
                  actorKey={actorKey}
                  mode="edit"
                  post={post}
                  trigger={
                    <DropdownMenuItem closeOnClick={false}>
                      Ubah Postingan
                    </DropdownMenuItem>
                  }
                />
                <CommunityPostDeleteDialog
                  tenantId={tenantId}
                  actorKey={actorKey}
                  postId={post.id}
                  trigger={
                    <DropdownMenuItem
                      variant="destructive"
                      closeOnClick={false}
                    >
                      Hapus Postingan
                    </DropdownMenuItem>
                  }
                />
              </>
            ) : (
              <CommunityReportDialog
                tenantId={tenantId}
                actorKey={actorKey}
                targetType="post"
                targetId={post.id}
                trigger={
                  <DropdownMenuItem closeOnClick={false}>
                    Laporkan Postingan
                  </DropdownMenuItem>
                }
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="space-y-3">
        {post.caption && (
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {post.caption}
          </p>
        )}

        {post.media.length > 0 && (
          <div
            className={cn(
              "grid gap-1 overflow-hidden rounded-md",
              post.media.length === 1 && "grid-cols-1",
              post.media.length === 2 && "grid-cols-2",
              post.media.length >= 3 && "grid-cols-2"
            )}
          >
            {post.media.map((media) => (
              /* eslint-disable-next-line @next/next/no-img-element -- authenticated private media proxy */
              <img
                key={media.id}
                src={media.url}
                alt="Foto postingan warga"
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggleLike}
            disabled={toggleLikeMutation.isPending}
            className={cn(post.likedByMe && "text-destructive")}
            data-testid="like-btn"
          >
            <HeartIcon
              className={cn("size-4", post.likedByMe && "fill-current")}
            />
            <span>{formatCommunityCount(post.likeCount)}</span>
          </Button>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MessageCircleIcon className="size-4" />
            <span>{formatCommunityCount(post.commentCount)}</span>
          </div>
        </div>

        <CommunityCommentSection
          tenantId={tenantId}
          actorKey={actorKey}
          postId={post.id}
          previewComments={post.previewComments}
          commentCount={post.commentCount}
        />
      </CardContent>
    </Card>
  )
}
