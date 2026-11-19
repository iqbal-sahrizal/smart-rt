"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ArrowDownIcon,
  EyeIcon,
  EyeOffIcon,
  ImagePlusIcon,
  Loader2Icon,
  MessageCircleIcon,
  ReplyIcon,
  SendIcon,
  ShieldAlertIcon,
  Trash2Icon,
  UsersIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react"

import {
  type ChatConnectionStatus,
  useLiveChatRoom,
} from "@/components/live-chat/use-live-chat-room"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getInitials } from "@/lib/auth/workspace"
import { compressChatImage } from "@/lib/live-chat/compress-image"
import { CHAT_MAX_IMAGE_BYTES } from "@/lib/live-chat/schemas"
import type {
  ChatAttachmentInput,
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
  variant?: "page" | "floating"
  isVisible?: boolean
  onClose?: () => void
}

interface PendingPhotoDraft {
  file: File
  previewUrl: string
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
  variant = "page",
  isVisible = true,
  onClose,
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
    markAsRead,
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
  const [replyingTo, setReplyingTo] = React.useState<ChatMessageItem | null>(null)
  const [longPressedId, setLongPressedId] = React.useState<string | null>(null)
  const [highlightedId, setHighlightedId] = React.useState<string | null>(null)
  const [pendingPhoto, setPendingPhoto] = React.useState<PendingPhotoDraft | null>(
    null
  )
  const [isUploadingPhoto, setIsUploadingPhoto] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = React.useState<string | null>(null)
  const [showScrollBottom, setShowScrollBottom] = React.useState(false)
  const [moderatingId, setModeratingId] = React.useState<string | null>(null)
  const [moderationReason, setModerationReason] = React.useState("")
  const [busyMessageId, setBusyMessageId] = React.useState<string | null>(null)

  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const longPressTimerRef = React.useRef<number | null>(null)
  const isNearBottomRef = React.useRef<boolean>(true)
  const prevMessageCountRef = React.useRef<number>(messages.length)
  const didInitialScrollRef = React.useRef<boolean>(false)

  // Prevent browser pull-to-refresh when pulling down at top/bottom bounds of chat timeline
  React.useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    let startY = 0
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? 0
      e.stopPropagation()
    }
    const onTouchMove = (e: TouchEvent) => {
      e.stopPropagation()
      const currentY = e.touches[0]?.clientY ?? 0
      const deltaY = currentY - startY
      const atTop = el.scrollTop <= 0
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= 1
      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        if (e.cancelable) e.preventDefault()
      }
    }
    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
    }
  }, [])

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

  // Mark room as read when panel/page is visible and messages are shown
  React.useEffect(() => {
    if (!isVisible) return
    try {
      window.SmartRTNative?.postMessage(
        JSON.stringify({
          action: "setPullToRefreshLocked",
          payload: { locked: true },
        })
      )
    } catch {
      // ignore outside native WebView
    }
    const latest = messages[messages.length - 1]
    if (!latest) {
      void markAsRead(undefined)
      return
    }
    if (isNearBottomRef.current || messages.length > 0) {
      void markAsRead(latest.id)
    }
    return () => {
      if (variant === "page") {
        try {
          window.SmartRTNative?.postMessage(
            JSON.stringify({
              action: "setPullToRefreshLocked",
              payload: { locked: false },
            })
          )
        } catch {
          // ignore
        }
      }
    }
  }, [isVisible, markAsRead, messages, variant])

  React.useEffect(() => {
    return () => {
      if (pendingPhoto?.previewUrl) {
        URL.revokeObjectURL(pendingPhoto.previewUrl)
      }
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current)
      }
    }
  }, [pendingPhoto])

  const clearPendingPhoto = () => {
    if (pendingPhoto?.previewUrl) {
      URL.revokeObjectURL(pendingPhoto.previewUrl)
    }
    setPendingPhoto(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handlePhotoSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    setLocalError(null)
    clearError()

    try {
      const compressed = await compressChatImage(rawFile)
      if (compressed.size > CHAT_MAX_IMAGE_BYTES) {
        setLocalError("Ukuran foto maksimal 5 MB.")
        return
      }
      if (pendingPhoto?.previewUrl) {
        URL.revokeObjectURL(pendingPhoto.previewUrl)
      }
      setPendingPhoto({
        file: compressed,
        previewUrl: URL.createObjectURL(compressed),
      })
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Gagal memproses foto."
      )
    }
  }

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

  const scrollToMessage = (targetId: string) => {
    const el = document.getElementById(`chat-msg-${targetId}`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    setHighlightedId(targetId)
    window.setTimeout(() => {
      setHighlightedId((curr) => (curr === targetId ? null : curr))
    }, 1600)
  }

  const handleTouchStartBubble = (msg: ChatMessageItem) => {
    if (msg.moderationStatus !== "published") return
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
    }
    longPressTimerRef.current = window.setTimeout(() => {
      setLongPressedId(msg.id)
    }, 450)
  }

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if ((!draft.trim() && !pendingPhoto) || connectionStatus === "offline") {
      return
    }
    setLocalError(null)

    let uploadedAttachment: ChatAttachmentInput | undefined
    if (pendingPhoto) {
      setIsUploadingPhoto(true)
      try {
        const fd = new FormData()
        fd.append("roomId", initialPage.room.id)
        fd.append("file", pendingPhoto.file)
        const res = await fetch("/api/live-chat/upload", {
          method: "POST",
          body: fd,
        })
        const data = (await res.json()) as {
          path?: string
          mimeType?: "image/jpeg" | "image/png" | "image/webp"
          size?: number
          error?: string
        }
        if (!res.ok || !data.path || !data.mimeType || !data.size) {
          throw new Error(data.error ?? "Gagal mengunggah foto.")
        }
        uploadedAttachment = {
          path: data.path,
          mimeType: data.mimeType,
          size: data.size,
        }
      } catch (err) {
        setIsUploadingPhoto(false)
        setLocalError(
          err instanceof Error ? err.message : "Gagal mengunggah foto."
        )
        return
      }
      setIsUploadingPhoto(false)
    }

    const ok = await sendMessage(draft, {
      replyToMessageId: replyingTo?.id,
      attachment: uploadedAttachment,
    })

    if (ok) {
      setDraft("")
      setReplyingTo(null)
      clearPendingPhoto()
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
  const activeError = localError ?? errorMessage
  const containerClass =
    variant === "floating"
      ? "flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden overscroll-y-contain border-0 bg-surface py-0 shadow-none"
      : "flex h-[calc(100dvh-10.5rem)] min-h-[480px] flex-col gap-0 overflow-hidden overscroll-y-contain border border-border bg-surface py-0 shadow-sm md:h-[calc(100dvh-11rem)]"

  return (
    <Card className={containerClass}>
      {/* Header Room */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3.5 py-2.5 md:px-4 md:py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary md:size-10">
            <MessageCircleIcon className="size-4 md:size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-sm font-semibold text-foreground md:text-base">
                {initialPage.room.name}
              </h1>
              {scope === "admin" && (
                <Badge variant="outline" className="text-[10px]">
                  Moderasi
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground md:text-xs">
              <span className="truncate">{tenantLabel}</span>
              <span>•</span>
              {renderConnectionBadge(connectionStatus)}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div
            className="flex items-center gap-1 rounded-full border border-border bg-surface-subtle px-2 py-1 text-[11px] font-medium text-foreground md:px-2.5 md:text-xs"
            title={onlineParticipants.map((p) => p.displayName).join(", ")}
          >
            <UsersIcon className="size-3 text-primary md:size-3.5" />
            <span>{onlineCount} online</span>
          </div>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Tutup panel obrolan"
              onClick={onClose}
              className="size-8 rounded-full"
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Offline / Error Banner */}
      {(connectionStatus === "offline" || activeError) && (
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
                {activeError}
              </>
            )}
          </span>
          {activeError && (
            <button
              type="button"
              onClick={() => {
                setLocalError(null)
                clearError()
              }}
              className="font-medium underline"
            >
              Tutup
            </button>
          )}
        </div>
      )}

      {/* Message Timeline */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-subtle/60"
        onClick={() => {
          if (longPressedId) setLongPressedId(null)
        }}
      >
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain touch-pan-y px-3 py-3 md:px-4"
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
              const isMasked = isDeleted || (isHidden && scope !== "admin")
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
                    id={`chat-msg-${msg.id}`}
                    className={`flex items-end gap-2 transition-colors duration-300 ${
                      isOwn ? "justify-end" : "justify-start"
                    } ${
                      highlightedId === msg.id
                        ? "rounded-xl bg-primary/10 py-1 ring-2 ring-primary/30"
                        : ""
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
                      className={`group flex max-w-[82%] flex-col md:max-w-[72%] ${
                        isOwn ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        onTouchStart={() => handleTouchStartBubble(msg)}
                        onTouchMove={cancelLongPress}
                        onTouchEnd={cancelLongPress}
                        onTouchCancel={cancelLongPress}
                        className={`rounded-2xl px-3.5 py-2 text-sm shadow-2xs ${
                          isMasked
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

                        {/* Quoted Reply Block */}
                        {!isMasked && msg.replyToMessageId && (
                          <button
                            type="button"
                            onClick={() => scrollToMessage(msg.replyToMessageId!)}
                            className={`mb-1.5 flex w-full flex-col rounded-lg border-l-3 px-2.5 py-1 text-left text-xs transition ${
                              isOwn
                                ? "border-primary-foreground/70 bg-primary-foreground/15 text-primary-foreground"
                                : "border-primary bg-muted/70 text-foreground"
                            }`}
                          >
                            <span className="font-semibold">
                              {msg.replyTo?.senderName ?? "Warga"}
                            </span>
                            <span className="line-clamp-2 opacity-85">
                              {msg.replyTo
                                ? msg.replyTo.content ||
                                  (msg.replyTo.hasAttachment ? "Foto" : "Pesan")
                                : "Pesan sebelumnya"}
                            </span>
                          </button>
                        )}

                        {/* Photo Attachment */}
                        {!isMasked && msg.attachmentUrl && (
                          <button
                            type="button"
                            onClick={() => setLightboxUrl(msg.attachmentUrl)}
                            className="mb-1.5 block overflow-hidden rounded-xl border border-black/10"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={msg.attachmentUrl}
                              alt="Lampiran foto chat"
                              loading="lazy"
                              className="max-h-60 w-auto max-w-full rounded-xl object-cover"
                            />
                          </button>
                        )}

                        {msg.content && (
                          <p className="whitespace-pre-wrap break-words leading-relaxed">
                            {msg.content}
                          </p>
                        )}

                        <div
                          className={`mt-1 flex items-center justify-end gap-2 text-[10px] ${
                            isOwn && !isMasked
                              ? "text-primary-foreground/75"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span>{formatMessageTime(msg.createdAt)}</span>

                          {msg.moderationStatus === "published" && (
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingTo(msg)
                                setLongPressedId(null)
                              }}
                              aria-label="Balas pesan"
                              className="hidden items-center gap-0.5 opacity-75 transition hover:opacity-100 md:inline-flex"
                            >
                              <ReplyIcon className="size-3" />
                              Balas
                            </button>
                          )}

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

                      {/* Mobile Long-Press Action Pill */}
                      {longPressedId === msg.id &&
                        msg.moderationStatus === "published" && (
                          <div className="mt-1 flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 shadow-sm md:hidden">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 gap-1 px-2 text-xs"
                              onClick={(ev) => {
                                ev.stopPropagation()
                                setReplyingTo(msg)
                                setLongPressedId(null)
                              }}
                            >
                              <ReplyIcon className="size-3" />
                              Balas
                            </Button>
                          </div>
                        )}

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

      {/* Reply Preview Banner */}
      {replyingTo && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-subtle px-3.5 py-2 text-xs">
          <div className="min-w-0 border-l-3 border-primary pl-2.5">
            <p className="font-semibold text-primary">
              Membalas {replyingTo.senderName}
            </p>
            <p className="truncate text-muted-foreground">
              {replyingTo.content ||
                (replyingTo.attachmentPath ? "Foto" : "Pesan")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Batalkan balasan"
            onClick={() => setReplyingTo(null)}
            className="size-7 shrink-0 rounded-full"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Pending Photo Preview */}
      {pendingPhoto && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-subtle px-3.5 py-2">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingPhoto.previewUrl}
              alt="Preview foto"
              className="size-12 rounded-lg border border-border object-cover"
            />
            <div className="text-xs">
              <p className="max-w-48 truncate font-medium text-foreground">
                {pendingPhoto.file.name}
              </p>
              <p className="text-muted-foreground">
                {(pendingPhoto.file.size / 1024).toFixed(0)} KB · Siap dikirim
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Hapus preview foto"
            onClick={clearPendingPhoto}
            className="size-7 rounded-full"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="flex shrink-0 items-end gap-2 border-t border-border bg-surface p-2.5 md:p-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handlePhotoSelected}
          className="hidden"
          aria-label="Pilih foto"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={connectionStatus === "offline" || isSending || isUploadingPhoto}
          aria-label="Unggah foto"
          title="Unggah foto (maks. 5 MB)"
          onClick={() => fileInputRef.current?.click()}
          className="size-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
        >
          <ImagePlusIcon className="size-5" />
        </Button>

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
              : pendingPhoto
                ? "Tambahkan keterangan foto (opsional)..."
                : "Tulis pesan ke grup warga RT..."
          }
          maxLength={2000}
          className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border border-border bg-surface-subtle px-3.5 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:bg-surface"
        />
        <Button
          type="submit"
          size="icon"
          disabled={
            (!draft.trim() && !pendingPhoto) ||
            isSending ||
            isUploadingPhoto ||
            connectionStatus === "offline"
          }
          aria-label="Kirim pesan"
          className="size-10 shrink-0 rounded-full"
        >
          {isSending || isUploadingPhoto ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SendIcon className="size-4" />
          )}
        </Button>
      </form>

      {/* Lightbox Modal for Photo */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Tutup foto"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 rounded-full"
          >
            <XIcon className="size-4" />
          </Button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Foto obrolan"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </Card>
  )
}
