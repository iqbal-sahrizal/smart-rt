"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { Loader2Icon, MessageCircleIcon, XIcon } from "lucide-react"

import { LiveChatRoomView } from "@/components/live-chat/live-chat-room-view"
import { useChatUnreadCount } from "@/components/live-chat/use-chat-unread"
import { Button } from "@/components/ui/button"
import type { ChatMessagesPage, ChatScope } from "@/lib/live-chat/types"

interface FloatingChatBootstrapData {
  scope: ChatScope
  tenantId: string
  tenantLabel: string
  initialPage: ChatMessagesPage
  currentUserId: string
  currentMemberId: string
  currentDisplayName: string
  currentRoleBadge: string
}

const HIDDEN_PATHS = [
  "/login",
  "/activate-account",
  "/no-access",
  "/select-tenant",
  "/resident/chat",
  "/obrolan",
]

function notifyNativePullToRefreshLock(locked: boolean) {
  if (typeof window === "undefined") return
  try {
    window.SmartRTNative?.postMessage(
      JSON.stringify({
        action: "setPullToRefreshLocked",
        payload: { locked },
      })
    )
  } catch {
    // ignore outside native WebView
  }
}

export function FloatingChatWidget({
  scope,
  enabled = true,
}: {
  scope: ChatScope
  enabled?: boolean
}) {
  const pathname = usePathname()
  const isSuppressedPath =
    !pathname ||
    HIDDEN_PATHS.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )

  const shouldRender = enabled && !isSuppressedPath
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [bootstrap, setBootstrap] =
    React.useState<FloatingChatBootstrapData | null>(null)

  const { unreadCount } = useChatUnreadCount(shouldRender)

  // Lock background page scroll & disable native Android SwipeRefreshLayout while floating chat is open
  React.useEffect(() => {
    if (!isOpen) {
      notifyNativePullToRefreshLock(false)
      return
    }
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevHtmlOverscroll = html.style.overscrollBehaviorY
    const prevBodyOverscroll = body.style.overscrollBehaviorY

    html.style.overflow = "hidden"
    body.style.overflow = "hidden"
    html.style.overscrollBehaviorY = "none"
    body.style.overscrollBehaviorY = "none"
    notifyNativePullToRefreshLock(true)

    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      html.style.overscrollBehaviorY = prevHtmlOverscroll
      body.style.overscrollBehaviorY = prevBodyOverscroll
      notifyNativePullToRefreshLock(false)
    }
  }, [isOpen])

  const openPanel = async () => {
    notifyNativePullToRefreshLock(true)
    setIsOpen(true)
    if (bootstrap || isLoading) return
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(
        `/api/live-chat/bootstrap?scope=${encodeURIComponent(scope)}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as FloatingChatBootstrapData & {
        error?: string
      }
      if (!res.ok) {
        throw new Error(data.error ?? "Gagal memuat obrolan RT.")
      }
      setBootstrap(data)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Gagal memuat obrolan RT."
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (!shouldRender) {
    return null
  }

  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount)

  return (
    <>
      {/* Floating Panel: Desktop bottom-right card, Mobile bottom sheet */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 md:pointer-events-none md:inset-auto md:right-6 md:bottom-22"
          aria-label="Panel Live Chat Warga"
        >
          {/* Mobile backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 touch-none bg-black/40 backdrop-blur-[1px] md:hidden"
          />

          <div
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute inset-x-0 bottom-0 flex h-[86dvh] max-h-[86dvh] min-h-0 flex-col overflow-hidden overscroll-y-contain rounded-t-2xl border border-border bg-surface shadow-2xl md:static md:h-[560px] md:max-h-[82dvh] md:w-[400px] md:rounded-2xl"
          >
            {isLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2Icon className="size-6 animate-spin text-primary" />
                <span>Memuat Live Chat Warga...</span>
              </div>
            ) : loadError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-destructive-text">{loadError}</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setBootstrap(null)
                      void openPanel()
                    }}
                  >
                    Coba Lagi
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsOpen(false)}
                  >
                    Tutup
                  </Button>
                </div>
              </div>
            ) : bootstrap ? (
              <LiveChatRoomView
                scope={bootstrap.scope}
                tenantId={bootstrap.tenantId}
                tenantLabel={bootstrap.tenantLabel}
                initialPage={bootstrap.initialPage}
                currentUserId={bootstrap.currentUserId}
                currentMemberId={bootstrap.currentMemberId}
                currentDisplayName={bootstrap.currentDisplayName}
                currentRoleBadge={bootstrap.currentRoleBadge}
                variant="floating"
                isVisible={isOpen}
                onClose={() => setIsOpen(false)}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Floating Action Button */}
      <button
        type="button"
        onClick={() => {
          if (isOpen) {
            setIsOpen(false)
          } else {
            void openPanel()
          }
        }}
        aria-label={isOpen ? "Tutup Live Chat Warga" : "Buka Live Chat Warga"}
        title="Live Chat Warga"
        className="fixed right-4 bottom-20 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-150 hover:scale-105 active:scale-95 md:right-6 md:bottom-6"
      >
        {isOpen ? (
          <XIcon className="size-6" />
        ) : (
          <MessageCircleIcon className="size-6" />
        )}
        {!isOpen && unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} pesan belum dibaca`}
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-white shadow-sm ring-2 ring-background"
          >
            {badgeLabel}
          </span>
        )}
      </button>
    </>
  )
}

