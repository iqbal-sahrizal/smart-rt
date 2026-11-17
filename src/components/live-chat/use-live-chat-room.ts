"use client"

import * as React from "react"

import {
  deleteOwnChatMessageAction,
  markChatRoomReadAction,
  moderateChatMessageAction,
  sendChatMessageAction,
} from "@/app/actions/live-chat"
import { emitChatReadSync } from "@/components/live-chat/use-chat-unread"
import {
  buildReplyPreviewFromRow,
  mapRawChatMessage,
  mergeRealtimeMessage,
  prependOlderMessages,
  type RawChatMessageRow,
} from "@/lib/live-chat/repository"
import type {
  ChatAttachmentInput,
  ChatMessageItem,
  ChatMessagesPage,
  ChatOnlineParticipant,
  ChatScope,
} from "@/lib/live-chat/types"
import { createClient } from "@/lib/supabase/client"

export type ChatConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"

interface TypingParticipant {
  userId: string
  displayName: string
  expiresAt: number
}

interface UseLiveChatRoomOptions {
  scope: ChatScope
  tenantId: string
  initialPage: ChatMessagesPage
  currentUserId: string
  currentMemberId: string
  currentDisplayName: string
  currentRoleBadge: string
}

export function useLiveChatRoom({
  scope,
  tenantId,
  initialPage,
  currentUserId,
  currentMemberId,
  currentDisplayName,
  currentRoleBadge,
}: UseLiveChatRoomOptions) {
  const [messages, setMessages] = React.useState<ChatMessageItem[]>(
    initialPage.items
  )
  const [hasMore, setHasMore] = React.useState<boolean>(initialPage.hasMore)
  const [oldestCursor, setOldestCursor] = React.useState<string | null>(
    initialPage.oldestCursor
  )
  const [isLoadingOlder, setIsLoadingOlder] = React.useState(false)
  const [isSending, setIsSending] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] =
    React.useState<ChatConnectionStatus>(
      typeof navigator !== "undefined" && !navigator.onLine
        ? "offline"
        : "connecting"
    )
  const [onlineParticipants, setOnlineParticipants] = React.useState<
    ChatOnlineParticipant[]
  >([])
  const [typingUsers, setTypingUsers] = React.useState<TypingParticipant[]>([])

  const channelRef = React.useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null)
  const lastTypingSentRef = React.useRef<number>(0)
  const hasConnectedOnceRef = React.useRef<boolean>(false)
  const lastMarkedReadIdRef = React.useRef<string | null>(null)
  const maskModerated = scope !== "admin"
  const roomId = initialPage.room.id

  const hydrateRealtimeSignedUrl = React.useCallback(
    async (messageId: string, storagePath: string) => {
      try {
        const res = await fetch(
          `/api/live-chat/media?roomId=${encodeURIComponent(roomId)}&path=${encodeURIComponent(storagePath)}`,
          { cache: "no-store" }
        )
        if (!res.ok) return
        const body = (await res.json()) as { signedUrl?: string }
        if (!body.signedUrl) return
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, attachmentUrl: body.signedUrl! } : m
          )
        )
      } catch {
        // Non-fatal
      }
    },
    [roomId]
  )

  const resyncLatestAfterReconnect = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/live-chat/messages?roomId=${encodeURIComponent(roomId)}&scope=${encodeURIComponent(scope)}&limit=30`,
        { cache: "no-store" }
      )
      if (!res.ok) return
      const payload = (await res.json()) as { items?: ChatMessageItem[] }
      if (!Array.isArray(payload.items)) return
      setMessages((prev) => {
        let merged = [...prev]
        for (const item of payload.items ?? []) {
          merged = mergeRealtimeMessage(merged, item)
        }
        return merged
      })
    } catch {
      // Ignore transient resync failures; channel stays active
    }
  }, [roomId, scope])

  React.useEffect(() => {
    const handleOnline = () => {
      setConnectionStatus("reconnecting")
      void resyncLatestAfterReconnect().then(() => {
        if (channelRef.current?.state === "joined") {
          setConnectionStatus("connected")
        }
      })
    }
    const handleOffline = () => {
      setConnectionStatus("offline")
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [resyncLatestAfterReconnect])

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now()
      setTypingUsers((prev) => prev.filter((item) => item.expiresAt > now))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  React.useEffect(() => {
    let isCancelled = false
    const supabase = createClient()
    const channelName = `live-chat:${tenantId}:${roomId}`
    let activeChannel: ReturnType<typeof supabase.channel> | null = null

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.access_token) {
        void supabase.realtime.setAuth(nextSession.access_token)
      }
    })

    const connectChannel = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (session?.access_token) {
          await supabase.realtime.setAuth(session.access_token)
        }
      } catch {
        // Proceed with best effort
      }

      if (isCancelled) return

      const channel = supabase.channel(channelName, {
        config: {
          presence: { key: currentMemberId },
          broadcast: { self: false },
        },
      })

      activeChannel = channel
      channelRef.current = channel

      channel
        .on("system", {}, (sys: { extension?: string; status?: string }) => {
          if (sys?.extension !== "postgres_changes") return
          if (sys.status === "ok") {
            const wasReconnect = hasConnectedOnceRef.current
            hasConnectedOnceRef.current = true
            setConnectionStatus("connected")
            if (wasReconnect) {
              void resyncLatestAfterReconnect()
            }
          } else if (sys.status === "error") {
            setConnectionStatus(
              typeof navigator !== "undefined" && !navigator.onLine
                ? "offline"
                : "reconnecting"
            )
          }
        })
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const row = (payload.new ?? null) as RawChatMessageRow | null
            if (!row || !row.id || row.tenant_id !== tenantId) return

            let needSignedUrl = false
            setMessages((prev) => {
              const replyTarget = row.reply_to_message_id
                ? prev.find((item) => item.id === row.reply_to_message_id)
                : undefined

              const replyPreview = replyTarget
                ? buildReplyPreviewFromRow(
                    {
                      id: replyTarget.id,
                      sender_name: replyTarget.senderName,
                      content: replyTarget.content,
                      attachment_path: replyTarget.attachmentPath,
                      moderation_status: replyTarget.moderationStatus,
                    },
                    maskModerated
                  )
                : null

              const mapped = mapRawChatMessage(row, maskModerated, {
                replyTo: replyPreview,
              })

              if (mapped.attachmentPath && !mapped.attachmentUrl) {
                const existingSame = prev.find(
                  (item) =>
                    item.id === mapped.id &&
                    item.attachmentPath === mapped.attachmentPath &&
                    item.attachmentUrl
                )
                if (existingSame) {
                  mapped.attachmentUrl = existingSame.attachmentUrl
                } else {
                  needSignedUrl = true
                }
              }

              // Update any existing messages in memory that quote this updated/deleted/hidden message
              const refreshedPrev =
                payload.eventType === "UPDATE"
                  ? prev.map((item) =>
                      item.replyToMessageId === mapped.id
                        ? {
                            ...item,
                            replyTo: buildReplyPreviewFromRow(
                              {
                                id: mapped.id,
                                sender_name: mapped.senderName,
                                content: mapped.content,
                                attachment_path: mapped.attachmentPath,
                                moderation_status: mapped.moderationStatus,
                              },
                              maskModerated
                            ),
                          }
                        : item
                    )
                  : prev

              if (
                !maskModerated &&
                mapped.moderationStatus === "hidden_by_moderator"
              ) {
                const existing = refreshedPrev.find(
                  (item) => item.id === mapped.id
                )
                if (existing && existing.moderationStatus === "published") {
                  return mergeRealtimeMessage(refreshedPrev, {
                    ...mapped,
                    content: existing.content,
                    attachmentPath: existing.attachmentPath,
                    attachmentMime: existing.attachmentMime,
                    attachmentSize: existing.attachmentSize,
                    attachmentUrl: existing.attachmentUrl,
                  })
                }
              }

              return mergeRealtimeMessage(refreshedPrev, mapped)
            })

            if (needSignedUrl && row.attachment_path) {
              void hydrateRealtimeSignedUrl(row.id, row.attachment_path)
            }
            if (!maskModerated && row.moderation_status === "hidden_by_moderator") {
              void resyncLatestAfterReconnect()
            }
          }
        )
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<ChatOnlineParticipant>()
          const seen = new Map<string, ChatOnlineParticipant>()
          for (const entries of Object.values(state)) {
            for (const entry of entries) {
              if (entry && entry.memberId) {
                seen.set(entry.memberId, entry)
              }
            }
          }
          setOnlineParticipants(Array.from(seen.values()))
        })
        .on("broadcast", { event: "typing" }, ({ payload }) => {
          const data = payload as {
            userId?: string
            displayName?: string
            isTyping?: boolean
          }
          if (!data?.userId || data.userId === currentUserId) return

          setTypingUsers((prev) => {
            const filtered = prev.filter((item) => item.userId !== data.userId)
            if (!data.isTyping) return filtered
            return [
              ...filtered,
              {
                userId: data.userId!,
                displayName: data.displayName || "Warga",
                expiresAt: Date.now() + 3500,
              },
            ]
          })
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            try {
              await channel.track({
                userId: currentUserId,
                memberId: currentMemberId,
                displayName: currentDisplayName,
                roleBadge: currentRoleBadge,
                onlineAt: new Date().toISOString(),
              })
            } catch {
              // Presence tracking error is non-fatal
            }
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            setConnectionStatus(
              typeof navigator !== "undefined" && !navigator.onLine
                ? "offline"
                : "reconnecting"
            )
          }
        })
    }

    void connectChannel()

    return () => {
      isCancelled = true
      authSubscription.unsubscribe()
      channelRef.current = null
      if (activeChannel) {
        void supabase.removeChannel(activeChannel)
      }
    }
  }, [
    currentDisplayName,
    currentMemberId,
    currentRoleBadge,
    currentUserId,
    hydrateRealtimeSignedUrl,
    maskModerated,
    resyncLatestAfterReconnect,
    roomId,
    tenantId,
  ])

  const emitTyping = React.useCallback(
    (isTyping: boolean) => {
      const channel = channelRef.current
      if (!channel) return
      const now = Date.now()
      if (isTyping && now - lastTypingSentRef.current < 1500) {
        return
      }
      lastTypingSentRef.current = isTyping ? now : 0
      void channel.send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: currentUserId,
          displayName: currentDisplayName,
          isTyping,
        },
      })
    },
    [currentDisplayName, currentUserId]
  )

  const markAsRead = React.useCallback(
    async (lastReadMessageId?: string) => {
      if (lastReadMessageId && lastMarkedReadIdRef.current === lastReadMessageId) {
        emitChatReadSync(roomId)
        return
      }
      if (lastReadMessageId) {
        lastMarkedReadIdRef.current = lastReadMessageId
      }
      emitChatReadSync(roomId)
      await markChatRoomReadAction({ roomId, lastReadMessageId })
    },
    [roomId]
  )

  const loadOlderMessages = React.useCallback(async () => {
    if (!hasMore || !oldestCursor || isLoadingOlder) return
    setIsLoadingOlder(true)
    setErrorMessage(null)
    try {
      const res = await fetch(
        `/api/live-chat/messages?roomId=${encodeURIComponent(roomId)}&scope=${encodeURIComponent(scope)}&before=${encodeURIComponent(oldestCursor)}`,
        { cache: "no-store" }
      )
      const body = (await res.json()) as {
        items?: ChatMessageItem[]
        hasMore?: boolean
        oldestCursor?: string | null
        error?: string
      }
      if (!res.ok) {
        throw new Error(body.error ?? "Gagal memuat pesan sebelumnya.")
      }
      setMessages((prev) => prependOlderMessages(prev, body.items ?? []))
      setHasMore(Boolean(body.hasMore))
      if (body.oldestCursor) {
        setOldestCursor(body.oldestCursor)
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Gagal memuat pesan sebelumnya."
      )
    } finally {
      setIsLoadingOlder(false)
    }
  }, [hasMore, isLoadingOlder, oldestCursor, roomId, scope])

  const sendMessage = React.useCallback(
    async (
      rawContent: string,
      options?: {
        replyToMessageId?: string
        attachment?: ChatAttachmentInput
      }
    ): Promise<boolean> => {
      const trimmed = rawContent.trim()
      if ((!trimmed && !options?.attachment) || isSending) return false

      setIsSending(true)
      setErrorMessage(null)
      emitTyping(false)

      const clientMessageId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : undefined

      const result = await sendChatMessageAction({
        roomId,
        content: trimmed,
        clientMessageId,
        replyToMessageId: options?.replyToMessageId,
        attachment: options?.attachment,
      })

      setIsSending(false)

      if (!result.ok) {
        setErrorMessage(result.error)
        return false
      }

      setMessages((prev) => mergeRealtimeMessage(prev, result.data))
      return true
    },
    [emitTyping, isSending, roomId]
  )

  const deleteOwnMessage = React.useCallback(async (messageId: string) => {
    setErrorMessage(null)
    const result = await deleteOwnChatMessageAction({ messageId })
    if (!result.ok) {
      setErrorMessage(result.error)
      return false
    }
    setMessages((prev) => mergeRealtimeMessage(prev, result.data))
    return true
  }, [])

  const moderateMessage = React.useCallback(
    async (
      messageId: string,
      action: "hide" | "restore",
      reason?: string
    ) => {
      setErrorMessage(null)
      const result = await moderateChatMessageAction({
        messageId,
        action,
        reason,
      })
      if (!result.ok) {
        setErrorMessage(result.error)
        return false
      }
      setMessages((prev) => mergeRealtimeMessage(prev, result.data))
      return true
    },
    []
  )

  return {
    messages,
    hasMore,
    isLoadingOlder,
    isSending,
    errorMessage,
    clearError: () => setErrorMessage(null),
    connectionStatus,
    onlineParticipants,
    typingUsers,
    emitTyping,
    markAsRead,
    loadOlderMessages,
    sendMessage,
    deleteOwnMessage,
    moderateMessage,
  }
}
