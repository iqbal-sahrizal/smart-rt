import { ResidentContainer } from "@/components/resident/resident-container"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function ResidentActivitiesListSkeleton() {
  return (
    <ResidentContainer className="flex flex-col gap-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    </ResidentContainer>
  )
}

export function ResidentActivityDetailSkeleton() {
  return (
    <ResidentContainer className="flex flex-col gap-5">
      <Skeleton className="h-8 w-36 rounded-lg" />
      <Card>
        <CardContent className="space-y-4 p-5">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </CardContent>
      </Card>
    </ResidentContainer>
  )
}

export function ResidentActivitiesHistorySkeleton() {
  return (
    <ResidentContainer className="flex flex-col gap-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </ResidentContainer>
  )
}

