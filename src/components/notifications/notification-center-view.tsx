"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowUpRightIcon,
  BellIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  InboxIcon,
  RefreshCwIcon,
} from "lucide-react"
import { cn } from "cn"

import { PageContainer } from "@/components/layout/page-container"
import { ResidentContainer } from "@/components/resident/resident-container"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  formatNotificationTimestamp,
  getNotificationTypeBadgeVariant,
  getNotificationTypeLabel,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListPage,
  type NotificationScope,
} from "@/lib/notifications/types"
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsInfiniteList,
} from "@/lib/notifications/use-notifications"

const FILTER_OPTIONS: { value: NotificationFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "unread", label: "Belum Dibaca" },
  { value: "read", label: "Sudah Dibaca" },
]

export interface NotificationCenterViewProps {
  scope: NotificationScope
  tenantId: string
  tenantName: string
  initialPage: NotificationListPage
  initialSelectedId?: string
}

export function NotificationCenterView({
  scope,
  tenantId,
  tenantName,
  initialPage,
  initialSelectedId,
}: NotificationCenterViewProps) {
  const [filter, setFilter] = React.useState<NotificationFilter>("all")
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [selectedItem, setSelectedItem] =
    React.useState<NotificationItem | null>(() => {
      if (!initialSelectedId) return null
      return (
        initialPage.items.find((item) => item.id === initialSelectedId) ?? null
      )
    })

  const listQuery = useNotificationsInfiniteList({
    scope,
    tenantId,
    filter,
    initialPage,
    initialFilter: "all",
    pageSize: 15,
  })

  const markOne = useMarkNotificationReadMutation({ scope, tenantId })
  const markAll = useMarkAllNotificationsReadMutation({ scope, tenantId })

  const pages = listQuery.data?.pages
  const items = React.useMemo(
    () => (pages ?? []).flatMap((page) => page.items),
    [pages]
  )
  const unreadCount = pages?.[0]?.unreadCount ?? initialPage.unreadCount
  const totalCount = pages?.[0]?.totalCount ?? initialPage.totalCount

  async function handleMarkAsRead(item: NotificationItem) {
    if (item.isRead) return
    setActionError(null)
    try {
      const result = await markOne.mutateAsync(item.id)
      setSelectedItem((current) =>
        current?.id === item.id
          ? {
              ...current,
              isRead: true,
              readAt: result.readAt ?? current.readAt,
            }
          : current
      )
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Gagal menandai notifikasi sebagai sudah dibaca."
      )
    }
  }

  async function handleOpenDetail(item: NotificationItem) {
    setSelectedItem(item)
    if (!item.isRead) {
      await handleMarkAsRead(item)
    }
  }

  async function handleMarkAllAsRead() {
    if (unreadCount === 0 || markAll.isPending) return
    setActionError(null)
    try {
      const result = await markAll.mutateAsync()
      setSelectedItem((current) =>
        current && !current.isRead
          ? {
              ...current,
              isRead: true,
              readAt: result.readAt ?? current.readAt,
            }
          : current
      )
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Gagal menandai semua notifikasi sebagai sudah dibaca."
      )
    }
  }

  const Container = scope === "admin" ? PageContainer : ResidentContainer

  return (
    <Container>
      {/* Page Header */}
      <div className="flex flex-col gap-[var(--space-4)] sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-[var(--space-1)]">
          <div className="flex items-center gap-[var(--space-2)]">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Pusat Notifikasi
            </h1>
            {unreadCount > 0 && (
              <Badge variant="info" size="default">
                {unreadCount} Belum Dibaca
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {scope === "admin"
              ? `Pembaruan operasional, tagihan, pembayaran, dan aktivitas RT di ${tenantName}.`
              : `Informasi pengumuman, tagihan, pembayaran, dan pembaruan penting dari ${tenantName}.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={listQuery.isFetching}
            onClick={() => void listQuery.refetch()}
            className="gap-1.5"
          >
            <RefreshCwIcon
              className={cn(
                "size-4",
                listQuery.isFetching && !listQuery.isFetchingNextPage && "animate-spin"
              )}
            />
            Muat Ulang
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={unreadCount === 0 || markAll.isPending}
            onClick={() => void handleMarkAllAsRead()}
            className="gap-1.5"
          >
            <CheckCheckIcon className="size-4" />
            {markAll.isPending ? "Memproses..." : "Tandai Semua Dibaca"}
          </Button>
        </div>
      </div>

      {/* Filter Tabs + Summary Strip */}
      <Card size="sm">
        <CardContent className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between">
          <div
            role="tablist"
            aria-label="Filter status notifikasi"
            className="inline-flex w-fit flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1"
          >
            {FILTER_OPTIONS.map((option) => {
              const active = filter === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setActionError(null)
                    setFilter(option.value)
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-surface text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span>{option.label}</span>
                  {option.value === "unread" && unreadCount > 0 && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">
                      {unreadCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Total {totalCount} notifikasi • {unreadCount} belum dibaca
          </p>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {(actionError || listQuery.isError) && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl border border-destructive-border bg-destructive-subtle px-4 py-3 text-sm text-destructive-text"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              {actionError ??
                listQuery.error?.message ??
                "Terjadi kendala saat memuat daftar notifikasi."}
            </span>
          </div>
          {listQuery.isError && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void listQuery.refetch()}
            >
              Coba Lagi
            </Button>
          )}
        </div>
      )}

      {/* Notification List */}
      {listQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-24 animate-pulse rounded-xl border border-border bg-surface/60"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              {filter === "unread" ? (
                <BellIcon className="size-5" />
              ) : (
                <InboxIcon className="size-5" />
              )}
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                {filter === "unread"
                  ? "Tidak ada notifikasi yang belum dibaca"
                  : filter === "read"
                    ? "Belum ada notifikasi yang sudah dibaca"
                    : "Belum ada notifikasi"}
              </h2>
              <p className="max-w-md text-xs text-muted-foreground">
                {filter === "unread"
                  ? "Semua notifikasi yang masuk untuk Anda saat ini sudah ditandai terbaca."
                  : "Notifikasi terkait aktivitas, tagihan, pembayaran, maupun pengumuman RT akan ditampilkan di sini."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const typeLabel = getNotificationTypeLabel(item.type)
            const badgeVariant = getNotificationTypeBadgeVariant(item.type)
            const isPendingThis =
              markOne.isPending && markOne.variables === item.id

            return (
              <Card
                key={item.id}
                size="sm"
                className={cn(
                  "transition-colors",
                  !item.isRead
                    ? "border-primary/35 bg-primary-subtle/20"
                    : "bg-surface"
                )}
              >
                <CardContent>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => void handleOpenDetail(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          void handleOpenDetail(item)
                        }
                      }}
                      className="min-w-0 flex-1 cursor-pointer space-y-2 text-left focus-visible:outline-none"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {!item.isRead && (
                          <span
                            aria-label="Belum dibaca"
                            className="size-2 shrink-0 rounded-full bg-primary"
                          />
                        )}
                        <Badge variant={badgeVariant} size="sm">
                          {typeLabel}
                        </Badge>
                        {!item.isRead ? (
                          <Badge variant="default" size="sm">
                            Baru
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            Sudah dibaca
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ClockIcon className="size-3" />
                          {formatNotificationTimestamp(item.createdAt)}
                        </span>
                      </div>

                      <h2
                        className={cn(
                          "text-sm text-foreground",
                          !item.isRead ? "font-semibold" : "font-medium"
                        )}
                      >
                        {item.title}
                      </h2>

                      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                      {!item.isRead && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={isPendingThis}
                          onClick={() => void handleMarkAsRead(item)}
                          className="gap-1"
                        >
                          <CheckIcon className="size-3.5" />
                          {isPendingThis ? "Menyimpan..." : "Tandai Dibaca"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => void handleOpenDetail(item)}
                      >
                        Detail
                      </Button>
                      {item.destinationHref && (
                        <Link
                          href={item.destinationHref}
                          onClick={() => {
                            if (!item.isRead) {
                              void handleMarkAsRead(item)
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-subtle/50"
                        >
                          Buka
                          <ArrowUpRightIcon className="size-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {listQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={listQuery.isFetchingNextPage}
                onClick={() => void listQuery.fetchNextPage()}
              >
                {listQuery.isFetchingNextPage
                  ? "Memuat notifikasi..."
                  : "Muat Lebih Banyak"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog
        open={Boolean(selectedItem)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedItem(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {selectedItem && (
            <>
              <DialogHeader>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge
                    variant={getNotificationTypeBadgeVariant(selectedItem.type)}
                    size="sm"
                  >
                    {getNotificationTypeLabel(selectedItem.type)}
                  </Badge>
                  <Badge
                    variant={selectedItem.isRead ? "outline" : "info"}
                    size="sm"
                  >
                    {selectedItem.isRead ? "Sudah dibaca" : "Belum dibaca"}
                  </Badge>
                </div>
                <DialogTitle>{selectedItem.title}</DialogTitle>
                <DialogDescription>
                  Diterima pada{" "}
                  {formatNotificationTimestamp(selectedItem.createdAt)}
                  {selectedItem.readAt
                    ? ` • Dibaca pada ${formatNotificationTimestamp(selectedItem.readAt)}`
                    : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-sm leading-relaxed whitespace-pre-line text-foreground">
                {selectedItem.body}
              </div>

              <DialogFooter>
                {!selectedItem.isRead && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={markOne.isPending}
                    onClick={() => void handleMarkAsRead(selectedItem)}
                  >
                    Tandai Dibaca
                  </Button>
                )}
                {selectedItem.destinationHref && (
                  <Link
                    href={selectedItem.destinationHref}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
                  >
                    Buka Halaman Terkait
                    <ArrowUpRightIcon className="size-4" />
                  </Link>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Container>
  )
}
