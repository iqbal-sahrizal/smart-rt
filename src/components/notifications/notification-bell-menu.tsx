"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BellIcon,
  CheckCheckIcon,
  ChevronRightIcon,
  InboxIcon,
  RefreshCwIcon,
} from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  formatNotificationRelative,
  formatNotificationTimestamp,
  getNotificationTypeLabel,
  type NotificationItem,
  type NotificationScope,
} from "@/lib/notifications/types"
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationSummary,
} from "@/lib/notifications/use-notifications"

interface NowStore {
  now: number
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
}

const nowStore: NowStore = {
  now: 0,
  listeners: new Set(),
  timer: null,
}

function subscribeNow(listener: () => void) {
  if (nowStore.now === 0) {
    nowStore.now = Date.now()
  }
  nowStore.listeners.add(listener)
  if (!nowStore.timer) {
    nowStore.timer = setInterval(() => {
      nowStore.now = Date.now()
      nowStore.listeners.forEach((cb) => cb())
    }, 30_000)
  }

  return () => {
    nowStore.listeners.delete(listener)
    if (nowStore.listeners.size === 0 && nowStore.timer) {
      clearInterval(nowStore.timer)
      nowStore.timer = null
    }
  }
}

function getClientNowSnapshot(): number | null {
  return nowStore.now === 0 ? null : nowStore.now
}

function getServerNowSnapshot(): number | null {
  return null
}

function useSyncedNowMs(): number | null {
  return React.useSyncExternalStore(
    subscribeNow,
    getClientNowSnapshot,
    getServerNowSnapshot
  )
}

export interface NotificationBellMenuProps {
  scope: NotificationScope
  tenantId?: string
  triggerClassName?: string
  iconClassName?: string
  buttonSize?: "icon" | "icon-sm"
}

export function NotificationBellMenu({
  scope,
  tenantId,
  triggerClassName,
  iconClassName,
  buttonSize = "icon-sm",
}: NotificationBellMenuProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const nowMs = useSyncedNowMs()

  const centerHref =
    scope === "admin" ? "/notifications" : "/resident/notifications"

  const summaryQuery = useNotificationSummary({ scope, tenantId })
  const markOne = useMarkNotificationReadMutation({ scope, tenantId })
  const markAll = useMarkAllNotificationsReadMutation({ scope, tenantId })

  const unreadCount = summaryQuery.data?.unreadCount ?? 0
  const recent = summaryQuery.data?.recent ?? []

  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount)
  const ariaLabel =
    unreadCount > 0
      ? `Notifikasi (${unreadCount} belum dibaca)`
      : "Notifikasi"

  async function handleSelectItem(item: NotificationItem) {
    setOpen(false)
    if (!item.isRead) {
      try {
        await markOne.mutateAsync(item.id)
      } catch {
        //Tetap lanjutkan navigasi agar pengguna tidak terhambat
      }
    }
    const targetHref =
      item.destinationHref ?? `${centerHref}?selected=${item.id}`
    router.push(targetHref)
  }

  async function handleMarkAll() {
    if (unreadCount === 0 || markAll.isPending) return
    await markAll.mutateAsync().catch(() => null)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={buttonSize}
            aria-label={ariaLabel}
            className={cn(
              "relative text-muted-foreground hover:text-foreground",
              triggerClassName
            )}
          />
        }
      >
        <BellIcon className={iconClassName} />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-surface"
          >
            {badgeText}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-[calc(100vw-1.5rem)] max-w-96 p-0 sm:w-96"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                Notifikasi
              </span>
              {unreadCount > 0 ? (
                <Badge variant="info" size="sm">
                  {unreadCount} belum dibaca
                </Badge>
              ) : (
                <span className="text-[11px] font-normal text-muted-foreground">
                  Semua terbaca
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={markAll.isPending}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void handleMarkAll()
                }}
                className="h-6 gap-1 px-1.5 text-[11px] text-primary hover:text-primary"
              >
                <CheckCheckIcon className="size-3.5" />
                {markAll.isPending ? "Memproses..." : "Tandai semua"}
              </Button>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-0" />

        <div className="max-h-80 overflow-y-auto">
          {summaryQuery.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="h-14 animate-pulse rounded-lg bg-muted/60"
                />
              ))}
            </div>
          ) : summaryQuery.isError ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                Gagal memuat notifikasi terbaru.
              </p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void summaryQuery.refetch()}
                className="gap-1"
              >
                <RefreshCwIcon className="size-3" />
                Coba Lagi
              </Button>
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <InboxIcon className="size-4" />
              </div>
              <p className="text-xs font-medium text-foreground">
                Belum ada notifikasi
              </p>
              <p className="text-[11px] text-muted-foreground">
                Pembaruan terbaru untuk Anda akan muncul di sini.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {recent.map((item) => {
                const timeLabel =
                  nowMs !== null
                    ? formatNotificationRelative(item.createdAt, nowMs)
                    : formatNotificationTimestamp(item.createdAt)

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void handleSelectItem(item)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none",
                      !item.isRead && "bg-primary-subtle/35"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        item.isRead ? "bg-transparent" : "bg-primary"
                      )}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={cn(
                            "line-clamp-1 text-xs text-foreground",
                            !item.isRead ? "font-semibold" : "font-medium"
                          )}
                        >
                          {item.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {timeLabel}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                      <span className="inline-block text-[10px] font-medium text-muted-foreground">
                        {getNotificationTypeLabel(item.type)}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <DropdownMenuSeparator className="my-0" />

        <div className="p-1.5">
          <Link
            href={centerHref}
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary-subtle/50"
          >
            Lihat semua notifikasi
            <ChevronRightIcon className="size-3.5" />
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

