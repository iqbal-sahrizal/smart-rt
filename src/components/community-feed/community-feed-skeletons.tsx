import { ResidentContainer } from "@/components/resident/resident-container"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

function PostSkeletonCard() {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="aspect-square w-full rounded-md" />
        <div className="flex items-center gap-4 pt-1">
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
      </CardContent>
    </Card>
  )
}

export function ResidentCommunityFeedSkeleton() {
  return (
    <ResidentContainer>
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      <Skeleton className="h-11 w-full rounded-md" />
      <div className="space-y-4">
        <PostSkeletonCard />
        <PostSkeletonCard />
        <PostSkeletonCard />
      </div>
    </ResidentContainer>
  )
}

export function AdminCommunityModerationSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-80" />
      </div>
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-2 pt-6">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
