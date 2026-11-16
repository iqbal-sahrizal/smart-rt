import * as React from "react"
import { cn } from "cn"

interface PageContainerProps {
  children: React.ReactNode
  className?: string
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 max-w-[var(--container-xl)] flex-col gap-[var(--space-5)] px-[var(--space-4)] py-[var(--space-5)] sm:gap-[var(--space-6)] sm:px-[var(--space-6)] sm:py-[var(--space-6)] lg:px-[var(--space-8)]",
        className
      )}
    >
      {children}
    </div>
  )
}

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-[var(--space-3)] sm:gap-[var(--space-4)] lg:flex-row lg:items-start xl:items-center",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-[var(--space-2)] lg:max-w-[58%] lg:shrink-0 lg:justify-end">
          {actions}
        </div>
      )}
    </div>
  )
}

