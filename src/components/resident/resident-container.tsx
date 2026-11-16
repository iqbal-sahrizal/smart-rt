import * as React from "react"
import { cn } from "cn"

interface ResidentContainerProps {
  children: React.ReactNode
  className?: string
}

export function ResidentContainer({
  children,
  className,
}: ResidentContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[var(--container-md)] flex-col gap-[var(--space-5)] px-[var(--space-4)] pt-[var(--space-5)] pb-24 sm:gap-[var(--space-6)] sm:px-[var(--space-6)] sm:pt-[var(--space-6)] md:pb-[var(--space-8)]",
        className
      )}
    >
      {children}
    </div>
  )
}

