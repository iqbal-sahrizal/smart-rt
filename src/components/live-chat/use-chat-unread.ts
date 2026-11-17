"use client"

import * as React from "react"

import { createClient } from "@/lib/supabase/client"

export const CHAT_READ_SYNC_EVENT = "smart-rt-chat-read"

export function emitChatReadSync(roomId: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(CHAT_READ_SYNC_EVENT, { detail: { roomId } })
  )
}

export function useChatUnreadCount(enabled = true) {
  const [roomId, setRoomId] = React.useState<string | null>(null)
  const [unreadCount, setUnreadCount] = React.useState<number>(0)
  const currentUserIdRef = React.useRef<string | null>(null)

  const refreshUnread = React.useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch("/api/live-chat/unread", { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as {
        roomId?: string | null
        unreadCount?: number
      }
      if (data.roomId) setRoomId(data.roomId)
      if (typeof data.unreadCount === "number") {
        setUnreadCount(Math.max(0, data.unreadCount))
      }
    } catch {
      // ignore transient errors
    }
  }, [enabled])

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const loadInitial = async () => {
      try {
        const res = await fetch("/api/live-chat/unread", { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          roomId?: string | null
          unreadCount?: number
        }
        if (cancelled) return
        if (data.roomId) setRoomId(data.roomId)
        if (typeof data.unreadCount === "number") {
          setUnreadCount(Math.max(0, data.unreadCount))
        }
      } catch {
        // ignore transient errors
      }
    }
    void loadInitial()
    return () => {
      cancelled = true
    }
  }, [enabled])

  React.useEffect(() => {
    if (!enabled) return
    const onRead = (ev: Event) => {
      const detail = (ev as CustomEvent<{ roomId?: string }>).detail
      if (!detail?.roomId || !roomId || detail.roomId === roomId) {
        setUnreadCount(0)
      }
    }
    window.addEventListener(CHAT_READ_SYNC_EVENT, onRead)
    return () => window.removeEventListener(CHAT_READ_SYNC_EVENT, onRead)
  }, [enabled, roomId])

  React.useEffect(() => {
    if (!enabled || !roomId) return
    let cancelled = false
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    const start = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (cancelled) return
        if (session?.user?.id) currentUserIdRef.current = session.user.id
        if (session?.access_token) {
          await supabase.realtime.setAuth(session.access_token)
        }
      } catch {
        // best effort
      }
      if (cancelled) return

      channel = supabase
        .channel(`chat-unread:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const row = payload.new as {
              sender_user_id?: string
              moderation_status?: string
            } | null
            if (!row || row.moderation_status !== "published") return
            if (
              currentUserIdRef.current &&
              row.sender_user_id === currentUserIdRef.current
            ) {
              return
            }
            setUnreadCount((prev) => prev + 1)
          }
        )
        .subscribe()
    }

    void start()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [enabled, roomId])

  return {
    roomId,
    unreadCount,
    refreshUnread,
  }
}
