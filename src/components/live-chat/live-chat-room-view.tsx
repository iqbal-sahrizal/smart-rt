"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ArrowDownIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  MessageCircleIcon,
  SendIcon,
  ShieldAlertIcon,
  Trash2Icon,
  UsersIcon,
  WifiOffIcon,
} from "lucide-react"

import {
  type ChatConnectionStatus,
  useLiveChatRoom,
} from "@/components/live-chat/use-live-chat-room"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getInitials } from "@/lib/auth/workspace"
import type {
  ChatMessageItem,
  ChatMessagesPage,
  ChatScope,
} from "@/lib/live-chat/types"

interface LiveChatRoomViewProps {
  scope: ChatScope
  tenantId: string
  tenantLabel: string
  initialPage: ChatMessagesPage
  currentUserId: string
  currentMemberId: string
  currentDisplayName: string
  currentRoleBadge: string
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  })
}

function formatDateHeading(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const today = new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })
  const msgDate = d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })
  if (msgDate === today) return "Hari ini"
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  })
}

function renderConnectionBadge(status: ChatConnectionStatus) {
  switch (status) {
    case "connected":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-success-text">
          <span className="size-2 rounded-full bg-emerald-500" />
          Realtime aktif
        </span>
      )
    case "reconnecting":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-warning-text">
          <Loader2Icon className="size-3 animate-spin" />
          Menghubungkan ulang...
        </span>
      )
    case "offline":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-destructive-text">
          <WifiOffIcon className="size-3" />
          Offline
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          Menghubungkan...
        </span>
      )
  }
}

export function LiveChatRoomView({
  scope,
  tenantId,
  tenantLabel,
  initialPage,
  currentUserId,
  currentMemberId,
  currentDisplayName,
  currentRoleBadge,
}: LiveChatRoomViewProps) {
  const {
    messages,
    hasMore,
    isLoadingOlder,
    isSending,
    errorMessage,
    clearError,
    connectionStatus,
    onlineParticipants,
    typingUsers,
    emitTyping,
    loadOlderMessages,
    sendMessage,
    deleteOwnMessage,
    moderateMessage,
  } = useLiveChatRoom({
    scope,
    tenantId,
    initialPage,
    currentUserId,
    currentMemberId,
    currentDisplayName,
    currentRoleBadge,
  })

  const [draft, setDraft] = React.useState("")
  const [showScrollBottom, setShowScrollBottom] = React.useState(false)
  const [moderatingId, setModeratingId] = React.useState<string | null>(null)
  const [moderationReason, setModerationReason] = React.useState("")
  const [busyMessageId, setBusyMessageId] = React.useState<string | null>(null)

  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const isNearBottomRef = React.useRef<boolean>(true)
  const prevMessageCountRef = React.useRef<number>(messages.length)
  const didInitialScrollRef = React.useRef<boolean>(false)

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  React.useEffect(() => {
    if (!didInitialScrollRef.current && scrollContainerRef.current) {
      didInitialScrollRef.current = true
      scrollToBottom("auto")
    }
  }, [scrollToBottom])

  React.useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const grew = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length
    if (grew && isNearBottomRef.current) {
      scrollToBottom("smooth")
    }
  }, [messages.length, scrollToBottom])

  const handleScroll = () => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distanceFromBottom < 120
    isNearBottomRef.current = nearBottom
    setShowScrollBottom(!nearBottom)
  }

  const handleLoadOlder = async () => {
    const el = scrollContainerRef.current
    const prevScrollHeight = el?.scrollHeight ?? 0
    const prevScrollTop = el?.scrollTop ?? 0
    await loadOlderMessages()
    requestAnimationFrame(() => {
      if (el) {
        const heightDelta = el.scrollHeight - prevScrollHeight
        el.scrollTop = prevScrollTop + Math.max(0, heightDelta)
      }
    })
  }

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!draft.trim() || connectionStatus === "offline") return
    const text = draft
    const ok = await sendMessage(text)
    if (ok) {
      setDraft("")
      isNearBottomRef.current = true
      requestAnimationFrame(() => scrollToBottom("smooth"))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleDeleteOwn = async (msgId: string) => {
    setBusyMessageId(msgId)
    await deleteOwnMessage(msgId)
    setBusyMessageId(null)
  }

  const handleModerate = async (
    msg: ChatMessageItem,
    action: "hide" | "restore"
  ) => {
    setBusyMessageId(msg.id)
    const ok = await moderateMessage(
      msg.id,
      action,
      action === "hide" ? moderationReason : undefined
    )
    setBusyMessageId(null)
    if (ok) {
      setModeratingId(null)
      setModerationReason("")
    }
  }

  const onlineCount = Math.max(onlineParticipants.length, 1)

  return (
    <Card className="flex h-[calc(100dvh-10.5rem)] min-h-[480px] flex-col overflow-hidden border border-border bg-surface shadow-sm md:h-[calc(100dvh-11rem)]">
      {/* Header Room */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MessageCircleIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-foreground md:text-base">
                {initialPage.room.name}
              </h1>
              {scope === "admin" && (
                <Badge variant="outline" className="text-[10px]">
                  Moderasi Pengurus
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
              <span className="truncate">{tenantLabel}</span>
              <span>•</span>
              {renderConnectionBadge(connectionStatus)}
            </div>
          </div>
        </div>

        <div
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-xs font-medium text-foreground"
          title={onlineParticipants.map((p) => p.displayName).join(", ")}
        >
          <UsersIcon className="size-3.5 text-primary" />
          <span>{onlineCount} online</span>
        </div>
      </div>

      {/* Offline / Error Banner */}
      {(connectionStatus === "offline" || errorMessage) && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-warning-border bg-warning-subtle px-4 py-2 text-xs text-warning-text"
        >
          <span className="flex items-center gap-2">
            {connectionStatus === "offline" ? (
              <>
                <WifiOffIcon className="size-3.5 shrink-0" />
                Koneksi terputus. Pesan baru akan muncul otomatis saat kembali online.
              </>
            ) : (
              <>
                <AlertCircleIcon className="size-3.5 shrink-0" />
                {errorMessage}
              </>
            )}
          </span>
          {errorMessage && (
            <button
              type="button"
              onClick={clearError}
              className="font-medium underline"
            >
              Tutup
            </button>
          )}
        </div>
      )}

      {/* Message Timeline */}
      <div className="relative flex-1 overflow-hidden bg-surface-subtle/60">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex h-full flex-col gap-2 overflow-y-auto px-3 py-3 md:px-4"
        >
          {hasMore && (
            <div className="flex justify-center py-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadOlder}
                disabled={isLoadingOlder}
                className="h-7 rounded-full text-xs"
              >
                {isLoadingOlder ? (
                  <>
                    <Loader2Icon className="mr-1.5 size-3 animate-spin" />
                    Memuat...
                  </>
                ) : (
                  "Muat pesan lebih lama"
                )}
              </Button>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageCircleIcon className="size-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Belum ada percakapan warga
              </p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Mulai obrolan santai atau koordinasi lingkungan bersama seluruh warga RT Anda.
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isOwn = msg.senderUserId === currentUserId
              const isDeleted = msg.moderationStatus === "deleted_by_sender"
              const isHidden = msg.moderationStatus === "hidden_by_moderator"
              const prevMsg = idx > 0 ? messages[idx - 1] : null
              const showDateDivider =
                !prevMsg ||
                formatDateHeading(prevMsg.createdAt) !==
                  formatDateHeading(msg.createdAt)
              const showSenderMeta =
                !isOwn &&
                (!prevMsg ||
                  prevMsg.senderUserId !== msg.senderUserId ||
                  showDateDivider)

              return (
                <React.Fragment key={msg.id}>
                  {showDateDivider && (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-full border border-border bg-surface px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-2xs">
                        {formatDateHeading(msg.createdAt)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`flex items-end gap-2 ${
                      isOwn ? "justify-end" : "justify-start"
                    }`}
                  >
                    {!isOwn && (
                      <div className="w-7 shrink-0">
                        {showSenderMeta && (
                          <div className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                            {getInitials(msg.senderName)}
                          </div>
                        )}
                      </div>
                    )}

                    <div
                      className={`group flex max-w-[82%] flex-col md:max-w-[70%] ${
                        isOwn ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm shadow-2xs ${
                          isDeleted || (isHidden && scope !== "admin")
                            ? "border border-border bg-surface text-muted-foreground italic"
                            : isOwn
                              ? "rounded-br-sm bg-primary text-primary-foreground"
                              : "rounded-bl-sm border border-border bg-surface text-foreground"
                        }`}
                      >
                        {showSenderMeta && (
                          <div className="mb-1 flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-primary">
                              {msg.senderName}
                            </span>
                            {msg.senderRoleBadge === "Pengurus" && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1.5 text-[10px]"
                              >
                                Pengurus
                              </Badge>
                            )}
                          </div>
                        )}

                        {isHidden && scope === "admin" && (
                          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-warning-text">
                            <ShieldAlertIcon className="size-3" />
                            <span>
                              Disembunyikan ({msg.moderationReason ?? "Moderasi"})
                            </span>
                          </div>
                        )}

                        <p className="whitespace-pre-wrap break-words leading-relaxed">
                          {msg.content}
                        </p>

                        <div
                          className={`mt-1 flex items-center justify-end gap-2 text-[10px] ${
                            isOwn && !isDeleted
                              ? "text-primary-foreground/75"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span>{formatMessageTime(msg.createdAt)}</span>

                          {isOwn && msg.moderationStatus === "published" && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteOwn(msg.id)}
                              disabled={busyMessageId === msg.id}
                              aria-label="Hapus pesan saya"
                              className="opacity-70 transition hover:opacity-100"
                            >
                              <Trash2Icon className="size-3" />
                            </button>
                          )}

                          {scope === "admin" && !isDeleted && (
                            <button
                              type="button"
                              onClick={() => {
                                if (isHidden) {
                                  void handleModerate(msg, "restore")
                                } else {
                                  setModeratingId(
                                    moderatingId === msg.id ? null : msg.id
                                  )
                                  setModerationReason("")
                                }
                              }}
                              disabled={busyMessageId === msg.id}
                              className="inline-flex items-center gap-0.5 font-medium underline opacity-85 hover:opacity-100"
                            >
                              {isHidden ? (
                                <>
                                  <EyeIcon className="size-3" />
                                  Pulihkan
                                </>
                              ) : (
                                <>
                                  <EyeOffIcon className="size-3" />
                                  Moderasi
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {scope === "admin" && moderatingId === msg.id && (
                        <div className="mt-1.5 flex w-full max-w-xs flex-col gap-1.5 rounded-lg border border-border bg-surface p-2.5 shadow-sm">
                          <input
                            type="text"
                            value={moderationReason}
                            onChange={(e) => setModerationReason(e.target.value)}
                            placeholder="Alasan sembunyikan pesan (min. 3 karakter)"
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground outline-none focus:border-primary"
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setModeratingId(null)}
                            >
                              Batal
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2.5 text-xs"
                              disabled={
                                moderationReason.trim().length < 3 ||
                                busyMessageId === msg.id
                              }
                              onClick={() => void handleModerate(msg, "hide")}
                            >
                              Sembunyikan
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              )
            })
          )}
        </div>

        {showScrollBottom && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              isNearBottomRef.current = true
              scrollToBottom("smooth")
            }}
            className="absolute right-4 bottom-3 rounded-full shadow-md"
          >
            <ArrowDownIcon className="mr-1 size-3.5" />
            Ke terbaru
          </Button>
        )}
      </div>

      {/* Typing Indicator */}
      {typingUsers.length > 0 && (
        <div className="border-t border-border/60 bg-surface px-4 py-1.5 text-xs text-muted-foreground">
          {typingUsers.length === 1
            ? `${typingUsers[0].displayName} sedang mengetik...`
            : `${typingUsers.length} warga sedang mengetik...`}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="flex items-end gap-2 border-t border-border bg-surface p-2.5 md:p-3"
      >
        <textarea
          rows={1}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            emitTyping(e.target.value.trim().length > 0)
          }}
          onBlur={() => emitTyping(false)}
          onKeyDown={handleKeyDown}
          disabled={connectionStatus === "offline"}
          placeholder={
            connectionStatus === "offline"
              ? "Sedang offline..."
              : "Tulis pesan ke grup warga RT..."
          }
          maxLength={2000}
          className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border border-border bg-surface-subtle px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:bg-surface"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!draft.trim() || isSending || connectionStatus === "offline"}
          aria-label="Kirim pesan"
          className="size-10 shrink-0 rounded-full"
        >
          {isSending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SendIcon className="size-4" />
          )}
        </Button>
      </form>
    </Card>
  )
}

