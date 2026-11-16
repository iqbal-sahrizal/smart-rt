"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  LogOutIcon,
  MenuIcon,
} from "lucide-react"

import { NotificationBellMenu } from "@/components/notifications/notification-bell-menu"

import { logoutAction } from "@/app/actions/auth"
import type { ShellUserInfo } from "@/lib/auth/types"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { getAdminBreadcrumbs } from "@/components/layout/nav-config"

interface AppHeaderProps {
  onOpenMobileMenu: () => void
  user?: ShellUserInfo
}

export function AppHeader({ onOpenMobileMenu, user }: AppHeaderProps) {
  const pathname = usePathname()
  const breadcrumbs = getAdminBreadcrumbs(pathname)
  const [isPending, startTransition] = React.useTransition()

  const displayName = user?.fullName ?? "Pengurus RT"
  const displayEmail = user?.email ?? ""
  const displayRole = user?.roleLabel ?? "Pengurus"
  const displayInitials = user?.initials ?? "RT"
  const displayTenant = user?.tenantName ?? "Smart RT"

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction()
    })
  }

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] flex h-[var(--size-topbar)] shrink-0 items-center justify-between gap-[var(--space-4)] border-b border-border bg-surface/95 px-[var(--space-4)] backdrop-blur-xs sm:px-[var(--space-6)]">
      {/* Left: Mobile Drawer Trigger + Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-[var(--space-2-5)] sm:gap-[var(--space-3)]">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="size-[var(--size-control-lg)] shrink-0 lg:hidden"
        >
          <MenuIcon />
        </Button>

        <Breadcrumb className="min-w-0 overflow-hidden">
          <BreadcrumbList className="flex-nowrap overflow-hidden">
            <BreadcrumbItem className="hidden min-w-0 sm:inline-flex">
              <BreadcrumbLink
                render={<Link href="/" />}
                className="max-w-44 truncate"
              >
                {displayTenant}
              </BreadcrumbLink>
            </BreadcrumbItem>
            {breadcrumbs.map((segment) => (
              <React.Fragment key={segment.label}>
                <BreadcrumbSeparator className="hidden shrink-0 sm:inline-flex" />
                <BreadcrumbItem className="min-w-0">
                  {segment.href ? (
                    <BreadcrumbLink
                      render={<Link href={segment.href} />}
                      className="max-w-36 truncate sm:max-w-48"
                    >
                      {segment.label}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="truncate font-medium text-foreground">
                      {segment.label}
                    </BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Right: Notifications, User Profile */}
      <div className="flex shrink-0 items-center gap-[var(--space-1-5)] sm:gap-[var(--space-3)]">
        {/* Notifications */}
        <NotificationBellMenu
          scope="admin"
          tenantId={user?.tenantId}
          buttonSize="icon"
          triggerClassName="size-[var(--size-control-lg)] sm:size-[var(--size-control-sm)]"
        />

        {/* User Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-[var(--size-control-lg)] gap-[var(--space-2)] px-[var(--space-1-5)] sm:h-[var(--size-control-md)]"
              />
            }
          >
            <Avatar size="sm">
              <AvatarFallback className="bg-navy text-[11px] font-medium text-navy-foreground">
                {displayInitials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden flex-col items-start text-left sm:flex">
              <span className="max-w-36 truncate text-xs leading-none font-medium text-foreground">
                {displayName}
              </span>
              <span className="mt-0.5 max-w-36 truncate text-[11px] leading-none text-muted-foreground">
                {displayRole}
              </span>
            </div>
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
                    {displayTenant} • {displayRole}
                  </span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {user?.hasMultipleWorkspaces && (
              <>
                <DropdownMenuItem render={<Link href="/select-tenant" />}>
                  <ArrowLeftRightIcon />
                  Ganti Workspace / RT
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
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
    </header>
  )
}

