"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  LogOutIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"

import { NotificationBellMenu } from "@/components/notifications/notification-bell-menu"
import { cn } from "cn"

import { logoutAction } from "@/app/actions/auth"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import {
  RESIDENT_NAV_ITEMS,
  isResidentRouteActive,
} from "@/components/resident/resident-nav-config"
import type { ShellUserInfo } from "@/lib/auth/types"

interface ResidentHeaderProps {
  user?: ShellUserInfo
}

export function ResidentHeader({ user }: ResidentHeaderProps) {
  const pathname = usePathname()
  const [isPending, startTransition] = React.useTransition()

  const displayName = user?.fullName ?? "Warga"
  const displayEmail = user?.email ?? ""
  const displayInitials = user?.initials ?? "WG"
  const displayTenant = user?.tenantName ?? "Portal Warga"
  const displaySubtitle = user?.tenantSubtitle ?? "RT 04 / RW 02"

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction()
    })
  }

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-surface/95 backdrop-blur-xs">
      <div className="mx-auto flex h-[var(--size-topbar)] w-full max-w-[var(--container-md)] items-center justify-between gap-[var(--space-3)] px-[var(--space-4)] sm:px-[var(--space-6)]">
        {/* Brand */}
        <Link
          href="/resident"
          className="min-w-0 shrink rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
        >
          <SmartRtLogo
            badgeText="Warga"
            title={displayTenant}
            subtitle={displaySubtitle}
            logoUrl={user?.tenantLogoUrl}
          />
        </Link>

        {/* Desktop Inline Navigation */}
        <nav
          aria-label="Navigasi Warga"
          className="hidden items-center gap-[var(--space-1)] md:flex"
        >
          {RESIDENT_NAV_ITEMS.map((item) => {
            const active = isResidentRouteActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-[var(--size-control-sm)] items-center rounded-md px-[var(--space-3)] text-sm transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/25",
                  active
                    ? "bg-primary-subtle font-medium text-primary"
                    : "text-foreground-secondary hover:bg-muted/70 hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Actions: Notification + Resident Profile & Logout */}
        <div className="flex items-center gap-[var(--space-1-5)]">
          <NotificationBellMenu
            scope="resident"
            tenantId={user?.tenantId}
            buttonSize="icon"
            triggerClassName="size-[var(--size-control-xl)] rounded-full md:size-[var(--size-control-md)]"
            iconClassName="size-[var(--size-icon-lg)] md:size-[var(--size-icon-md)]"
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Menu Akun Warga"
                  className="h-[var(--size-control-xl)] gap-[var(--space-2)] rounded-full px-[var(--space-1-5)] md:h-[var(--size-control-md)]"
                />
              }
            >
              <Avatar size="default">
                <AvatarFallback className="bg-primary-subtle text-xs font-medium text-primary">
                  {displayInitials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-28 truncate text-sm font-medium text-foreground sm:inline">
                {displayName}
              </span>
              <ChevronDownIcon className="hidden size-[var(--size-icon-sm)] text-muted-foreground sm:block" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="truncate text-xs font-medium text-foreground">
                      {displayName}
                    </span>
                    {displayEmail && (
                      <span className="truncate text-[11px] font-normal text-muted-foreground">
                        {displayEmail}
                      </span>
                    )}
                    <span className="mt-1 truncate text-[11px] font-normal text-muted-foreground">
                      {displayTenant} • {user?.roleLabel ?? "Warga"}
                    </span>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              {user?.hasMultipleWorkspaces && (
                <DropdownMenuItem render={<Link href="/select-tenant" />}>
                  <ArrowLeftRightIcon />
                  Ganti Workspace / RT
                </DropdownMenuItem>
              )}
              <DropdownMenuItem render={<Link href="/resident/profile" />}>
                <UserIcon />
                Profil Warga
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/resident/household" />}>
                <UsersIcon />
                Kartu Keluarga
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={isPending}
                onClick={handleLogout}
              >
                <LogOutIcon />
                {isPending ? "Keluar..." : "Keluar"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
