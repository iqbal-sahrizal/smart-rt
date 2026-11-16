import * as React from "react"
import { cn } from "cn"

interface SmartRtLogoProps {
  collapsed?: boolean
  badgeText?: string
  subtitle?: string
  className?: string
}

export function SmartRtLogo({
  collapsed = false,
  badgeText = "Admin",
  subtitle = "RT 04 / RW 02",
  className,
}: SmartRtLogoProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-[var(--space-2-5)] select-none",
        collapsed && "justify-center",
        className
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-navy text-navy-foreground shadow-xs">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M4 10.5L12 4L20 10.5V18.5C20 19.3284 19.3284 20 18.5 20H5.5C4.67157 20 4 19.3284 4 18.5V10.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M9 20V13.5C9 12.6716 9.67157 12 10.5 12H13.5C14.3284 12 15 12.6716 15 13.5V20"
            stroke="#3B82F6"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="12" cy="8.25" r="1.25" fill="#14B8A6" />
        </svg>
      </div>

      {!collapsed && (
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-[var(--space-1-5)]">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              Smart RT
            </span>
            <span className="rounded-xs bg-primary-subtle px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-info-text uppercase">
              {badgeText}
            </span>
          </div>
          <span className="truncate text-[11px] leading-tight text-muted-foreground">
            {subtitle}
          </span>
        </div>
      )}
    </div>
  )
}

