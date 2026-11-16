"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"

import {
  RESIDENT_NAV_ITEMS,
  isResidentRouteActive,
} from "@/components/resident/resident-nav-config"

export function ResidentBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navigasi Utama Warga"
      className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xs md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5 px-0.5 py-[var(--space-1-5)] sm:px-[var(--space-1)]">
        {RESIDENT_NAV_ITEMS.map((item) => {
          const active = isResidentRouteActive(pathname, item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1 text-[9px] leading-tight tracking-[-0.02em] transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/25 active:scale-[0.98] min-[360px]:text-[10px] min-[430px]:px-1 min-[430px]:text-[11px] min-[430px]:tracking-normal",
                active
                  ? "font-semibold text-primary"
                  : "font-medium text-muted-foreground hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-11 items-center justify-center rounded-full transition-colors duration-150 sm:w-12",
                  active
                    ? "bg-primary-subtle text-primary"
                    : "group-hover:bg-muted/70"
                )}
              >
                <Icon className="size-[var(--size-icon-lg)]" />
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

