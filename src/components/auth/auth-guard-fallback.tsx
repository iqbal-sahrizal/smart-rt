import { Skeleton } from "@/components/ui/skeleton"

export function AuthGuardFallback() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <div className="flex h-[var(--size-topbar)] items-center justify-between border-b border-border bg-surface px-[var(--space-6)]">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <div className="mx-auto flex w-full max-w-[var(--container-lg)] flex-1 flex-col gap-[var(--space-4)] p-[var(--space-6)]">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}

