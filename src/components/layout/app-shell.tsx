"use client"

import * as React from "react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { FloatingChatWidget } from "@/components/live-chat/floating-chat-widget"
import { useChatUnreadCount } from "@/components/live-chat/use-chat-unread"
import { AppHeader } from "@/components/layout/app-header"
import { AppSidebar, SidebarNav } from "@/components/layout/app-sidebar"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import type { ShellUserInfo } from "@/lib/auth/types"
import { canModerateLiveChat } from "@/lib/live-chat/types"

interface AppShellProps {
  children: React.ReactNode
  user?: ShellUserInfo
  navBadges?: Partial<Record<string, string>>
}

export function AppShell({ children, user, navBadges }: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const canUseAdminChat = Boolean(
    user?.tenantId && canModerateLiveChat(user.roles ?? [])
  )
  const { unreadCount } = useChatUnreadCount(canUseAdminChat)

  const mergedNavBadges = React.useMemo(() => {
    if (!canUseAdminChat || unreadCount <= 0) return navBadges
    return {
      ...navBadges,
      "/obrolan": unreadCount > 99 ? "99+" : String(unreadCount),
    }
  }, [canUseAdminChat, navBadges, unreadCount])

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Desktop Collapsible Sidebar */}
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
        tenantSubtitle={user?.tenantSubtitle}
        tenantName={user?.tenantName}
        tenantLogoUrl={user?.tenantLogoUrl}
        userRoles={user?.roles}
        navBadges={mergedNavBadges}
      />

      {/* Mobile Navigation Drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[var(--size-sidebar)] p-0">
          <SheetHeader className="h-[var(--size-topbar)] justify-center border-b border-border px-[var(--space-4)]">
            <SheetTitle className="sr-only">Smart RT Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Main navigation menu for Smart RT Admin Dashboard
            </SheetDescription>
            <SmartRtLogo
              subtitle={user?.tenantSubtitle}
              title={user?.tenantName}
              logoUrl={user?.tenantLogoUrl}
            />
          </SheetHeader>
          <SidebarNav
            onNavigate={() => setMobileOpen(false)}
            userRoles={user?.roles}
            navBadges={mergedNavBadges}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenMobileMenu={() => setMobileOpen(true)} user={user} />
        <main className="flex-1">{children}</main>
      </div>

      <FloatingChatWidget scope="admin" enabled={canUseAdminChat} />
    </div>
  )
}

