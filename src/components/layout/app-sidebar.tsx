"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChevronDownIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  findActiveAdminNavGroupId,
  getVisibleAdminNavGroups,
  resolveActiveAdminNavHref,
  type AdminNavEntry,
  type AdminNavSubItem,
} from "@/components/layout/nav-config"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import type { RoleCode } from "@/lib/auth/types"

interface SidebarNavProps {
  collapsed?: boolean
  onNavigate?: () => void
  userRoles?: readonly RoleCode[]
  navBadges?: Partial<Record<string, string>>
}

function SubmenuLinkItem({
  item,
  badge,
  active,
  onNavigate,
}: {
  item: AdminNavSubItem
  badge?: string
  active: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/25",
        active
          ? "bg-primary-subtle font-medium text-primary"
          : "text-foreground-secondary hover:bg-muted/70 hover:text-foreground"
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 transition-colors duration-150",
          active
            ? "text-primary"
            : "text-muted-foreground group-hover:text-foreground"
        )}
      />
      <span className="flex-1 truncate">{item.title}</span>
      {badge && (
        <Badge
          variant={active ? "default" : "secondary"}
          size="sm"
          className="h-5 min-w-5 justify-center px-1.5 tabular-nums"
        >
          {badge}
        </Badge>
      )}
    </Link>
  )
}

function DirectNavLinkItem({
  title,
  href,
  icon: Icon,
  badge,
  active,
  collapsed,
  tooltipLabel,
  onNavigate,
}: {
  title: string
  href: string
  icon: AdminNavSubItem["icon"]
  badge?: string
  active: boolean
  collapsed: boolean
  tooltipLabel?: string
  onNavigate?: () => void
}) {
  const linkContent = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-[var(--size-control-md)] items-center gap-[var(--space-2-5)] rounded-md px-[var(--space-2-5)] text-sm transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/25",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary-subtle font-semibold text-primary"
          : "font-medium text-foreground hover:bg-muted/70"
      )}
    >
      {active && !collapsed && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <Icon
        aria-hidden="true"
        className={cn(
          "size-[var(--size-icon-md)] shrink-0 transition-colors duration-150",
          active
            ? "text-primary"
            : "text-muted-foreground group-hover:text-foreground"
        )}
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{title}</span>
          {badge && (
            <Badge
              variant={active ? "default" : "secondary"}
              size="sm"
              className="h-5 min-w-5 justify-center px-1.5 tabular-nums"
            >
              {badge}
            </Badge>
          )}
        </>
      )}
    </Link>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger render={linkContent} />
        <TooltipContent side="right" sideOffset={8}>
          <div className="flex items-center gap-[var(--space-2)]">
            <span>{tooltipLabel ?? title}</span>
            {badge && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {badge}
              </span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  return linkContent
}

function getGroupAggregatedBadge(
  entry: Extract<AdminNavEntry, { kind: "group" }>,
  navBadges?: Partial<Record<string, string>>
): string | undefined {
  if (!navBadges) return undefined
  for (const sub of entry.items) {
    const val = navBadges[sub.href]
    if (val) return val
  }
  return undefined
}

export function SidebarNav({
  collapsed = false,
  onNavigate,
  userRoles,
  navBadges,
}: SidebarNavProps) {
  const pathname = usePathname()
  const visibleEntries = React.useMemo(
    () => getVisibleAdminNavGroups(userRoles),
    [userRoles]
  )
  const activeHref = React.useMemo(
    () => resolveActiveAdminNavHref(pathname, visibleEntries),
    [pathname, visibleEntries]
  )
  const activeGroupId = React.useMemo(
    () => findActiveAdminNavGroupId(pathname, userRoles),
    [pathname, userRoles]
  )

  const [prevActiveGroupId, setPrevActiveGroupId] = React.useState(activeGroupId)
  const [expandedGroups, setExpandedGroups] = React.useState<
    Record<string, boolean>
  >(() => (activeGroupId ? { [activeGroupId]: true } : {}))

  if (activeGroupId !== prevActiveGroupId) {
    setPrevActiveGroupId(activeGroupId)
    if (activeGroupId && !expandedGroups[activeGroupId]) {
      setExpandedGroups((prev) => ({ ...prev, [activeGroupId]: true }))
    }
  }

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }))
  }

  if (collapsed) {
    return (
      <nav
        aria-label="Primary Navigation"
        className="flex flex-1 flex-col gap-[var(--space-1)] overflow-y-auto px-[var(--space-2)] py-[var(--space-4)]"
      >
        {visibleEntries.flatMap((entry) => {
          if (entry.kind === "link") {
            return [
              <DirectNavLinkItem
                key={entry.href}
                title={entry.title}
                href={entry.href}
                icon={entry.icon}
                badge={navBadges?.[entry.href]}
                active={activeHref === entry.href}
                collapsed
                onNavigate={onNavigate}
              />,
            ]
          }
          return entry.items.map((sub) => (
            <DirectNavLinkItem
              key={sub.href}
              title={sub.title}
              href={sub.href}
              icon={sub.icon}
              badge={navBadges?.[sub.href]}
              active={activeHref === sub.href}
              collapsed
              tooltipLabel={`${entry.label} • ${sub.title}`}
              onNavigate={onNavigate}
            />
          ))
        })}
      </nav>
    )
  }

  return (
    <nav
      aria-label="Primary Navigation"
      className="flex flex-1 flex-col gap-[var(--space-1-5)] overflow-y-auto px-[var(--space-2-5)] py-[var(--space-4)]"
    >
      {visibleEntries.map((entry) => {
        if (entry.kind === "link") {
          return (
            <DirectNavLinkItem
              key={entry.id}
              title={entry.title}
              href={entry.href}
              icon={entry.icon}
              badge={navBadges?.[entry.href]}
              active={activeHref === entry.href}
              collapsed={false}
              onNavigate={onNavigate}
            />
          )
        }

        const GroupIcon = entry.icon
        const isGroupActive = entry.items.some((sub) => sub.href === activeHref)
        const isOpen = Boolean(expandedGroups[entry.id])
        const submenuId = `sidebar-submenu-${entry.id}`
        const groupBadge = !isOpen
          ? getGroupAggregatedBadge(entry, navBadges)
          : undefined

        return (
          <div key={entry.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={submenuId}
              onClick={() => toggleGroup(entry.id)}
              className={cn(
                "group flex h-[var(--size-control-md)] w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/25",
                isGroupActive
                  ? "font-semibold text-primary"
                  : "font-semibold text-foreground/90 hover:bg-muted/70 hover:text-foreground"
              )}
            >
              <GroupIcon
                aria-hidden="true"
                className={cn(
                  "size-[var(--size-icon-md)] shrink-0 transition-colors duration-150",
                  isGroupActive
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span className="flex-1 truncate">{entry.label}</span>
              {groupBadge && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="h-5 min-w-5 justify-center px-1.5 tabular-nums"
                >
                  {groupBadge}
                </Badge>
              )}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
              />
            </button>

            <div
              id={submenuId}
              hidden={!isOpen}
              className={cn(
                "ml-4 flex flex-col gap-0.5 border-l border-sidebar-border pl-2.5",
                isOpen && "animate-in fade-in-0 slide-in-from-top-1 duration-150"
              )}
            >
              {entry.items.map((sub) => (
                <SubmenuLinkItem
                  key={sub.href}
                  item={sub}
                  badge={navBadges?.[sub.href]}
                  active={activeHref === sub.href}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

interface AppSidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  tenantSubtitle?: string
  userRoles?: readonly RoleCode[]
  navBadges?: Partial<Record<string, string>>
}

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  tenantSubtitle,
  userRoles,
  navBadges,
}: AppSidebarProps) {
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out lg:sticky lg:top-0 lg:flex lg:h-screen",
        collapsed
          ? "w-[var(--size-sidebar-collapsed)]"
          : "w-[var(--size-sidebar)]"
      )}
    >
      {/* Brand Header */}
      <div
        className={cn(
          "flex h-[var(--size-topbar)] shrink-0 items-center border-b border-sidebar-border px-[var(--space-3)]",
          collapsed ? "justify-center" : "justify-between"
        )}
      >
        <Link
          href="/"
          className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
        >
          <SmartRtLogo collapsed={collapsed} subtitle={tenantSubtitle} />
        </Link>

        {!collapsed && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggleCollapse}
                  aria-label="Collapse sidebar"
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              <PanelLeftCloseIcon />
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Navigation Links */}
      <SidebarNav
        collapsed={collapsed}
        userRoles={userRoles}
        navBadges={navBadges}
      />

      {/* Expand Trigger when Collapsed */}
      {collapsed && (
        <div className="flex items-center justify-center border-t border-sidebar-border p-[var(--space-2)]">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggleCollapse}
                  aria-label="Expand sidebar"
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              <PanelLeftOpenIcon />
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      )}
    </aside>
  )
}

