"use client"

import * as React from "react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { AppHeader } from "@/components/layout/app-header"
import { AppSidebar, SidebarNav } from "@/components/layout/app-sidebar"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import type { ShellUserInfo } from "@/lib/auth/types"

interface AppShellProps {
  children: React.ReactNode
  user?: ShellUserInfo
  navBadges?: Partial<Record<string, string>>
}

export function AppShell({ children, user, navBadges }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Desktop Collapsible Sidebar */}
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
        tenantSubtitle={user?.tenantSubtitle}
        userRoles={user?.roles}
        navBadges={navBadges}
      />

      {/* Mobile Navigation Drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[var(--size-sidebar)] p-0">
          <SheetHeader className="h-[var(--size-topbar)] justify-center border-b border-border px-[var(--space-4)]">
            <SheetTitle className="sr-only">Smart RT Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Main navigation menu for Smart RT Admin Dashboard
            </SheetDescription>
            <SmartRtLogo subtitle={user?.tenantSubtitle} />
          </SheetHeader>
          <SidebarNav
            onNavigate={() => setMobileOpen(false)}
            userRoles={user?.roles}
            navBadges={navBadges}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenMobileMenu={() => setMobileOpen(true)} user={user} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}

