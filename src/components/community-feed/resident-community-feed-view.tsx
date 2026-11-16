"use client"

import { AlertCircleIcon, ImageIcon, RefreshCwIcon } from "lucide-react"

import { ResidentContainer } from "@/components/resident/resident-container"
import { Button } from "@/components/ui/button"
import { CommunityPostCard } from "@/components/community-feed/community-post-card"
import { CommunityPostComposerDialog } from "@/components/community-feed/community-post-composer-dialog"
import { ResidentCommunityFeedSkeleton } from "@/components/community-feed/community-feed-skeletons"
import { useResidentCommunityFeed } from "@/lib/community-feed/hooks"
import type { CommunityFeedPage } from "@/lib/community-feed/types"

interface ResidentCommunityFeedViewProps {
  tenantId: string
  actorKey: string
  initialData: CommunityFeedPage | null
  initialError: string | null
}

export function ResidentCommunityFeedView({
  tenantId,
  actorKey,
  initialData,
  initialError,
}: ResidentCommunityFeedViewProps) {
  const feedQuery = useResidentCommunityFeed({
    tenantId,
    actorKey,
    initialData: initialData ?? undefined,
  })

  const posts = feedQuery.data?.pages.flatMap((page) => page.items) ?? []
  const isInitialLoading = feedQuery.isLoading && posts.length === 0
  const showError =
    (feedQuery.isError || (!feedQuery.data && initialError)) &&
    posts.length === 0

  if (isInitialLoading) {
    return <ResidentCommunityFeedSkeleton />
  }

  return (
    <ResidentContainer>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Feed Komunitas
          </h1>
          <p className="text-sm text-muted-foreground">
            Berbagi momen dan aktivitas dengan warga RT Anda.
          </p>
        </div>
        <CommunityPostComposerDialog
          tenantId={tenantId}
          actorKey={actorKey}
          mode="create"
        />
      </div>

      {showError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <p>
              {feedQuery.error?.message ??
                initialError ??
                "Gagal memuat feed komunitas."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => feedQuery.refetch()}
            >
              <RefreshCwIcon className="size-3.5" />
              <span>Coba Lagi</span>
            </Button>
          </div>
        </div>
      )}

      {!showError && posts.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <ImageIcon className="size-10 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">
              Belum ada postingan di feed komunitas
            </p>
            <p className="text-sm text-muted-foreground">
              Jadilah warga pertama yang membagikan momen di lingkungan Anda.
            </p>
          </div>
          <CommunityPostComposerDialog
            tenantId={tenantId}
            actorKey={actorKey}
            mode="create"
          />
        </div>
      )}

      {posts.length > 0 && (
        <div className="space-y-4" data-testid="community-feed-list">
          {posts.map((post) => (
            <CommunityPostCard
              key={post.id}
              tenantId={tenantId}
              actorKey={actorKey}
              post={post}
            />
          ))}
        </div>
      )}

      {feedQuery.hasNextPage && (
        <div className="flex justify-center pb-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => feedQuery.fetchNextPage()}
            disabled={feedQuery.isFetchingNextPage}
            data-testid="load-more-feed-btn"
          >
            {feedQuery.isFetchingNextPage ? "Memuat..." : "Muat Postingan Lainnya"}
          </Button>
        </div>
      )}
    </ResidentContainer>
  )
}
