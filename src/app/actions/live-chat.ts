"use server"

import {
  resolveAnyOperationalChatContext,
  resolveScopedChatContext,
} from "@/lib/live-chat/queries"
import {
  deleteOwnChatMessageWithClient,
  moderateChatMessageWithClient,
  sendChatMessageWithClient,
} from "@/lib/live-chat/repository"
import {
  deleteOwnChatMessageSchema,
  moderateChatMessageSchema,
  sendChatMessageSchema,
} from "@/lib/live-chat/schemas"
import type { ChatMessageItem } from "@/lib/live-chat/types"
import { createClient } from "@/lib/supabase/server"

export type ChatActionResult<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: string }

export async function sendChatMessageAction(input: {
  roomId: string
  content: string
  clientMessageId?: string
}): Promise<ChatActionResult<ChatMessageItem>> {
  const parsed = sendChatMessageSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      data: null,
      error:
        parsed.error.issues[0]?.message ?? "Pesan obrolan tidak valid.",
    }
  }

  const auth = await resolveAnyOperationalChatContext()
  if (auth.status === "unauthenticated") {
    return { ok: false, data: null, error: "Sesi login Anda telah berakhir." }
  }
  if (auth.status === "forbidden") {
    return {
      ok: false,
      data: null,
      error: "Anda tidak memiliki akses untuk mengirim pesan pada RT ini.",
    }
  }

  try {
    const supabase = await createClient()
    const item = await sendChatMessageWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      roomId: parsed.data.roomId,
      content: parsed.data.content,
      clientMessageId: parsed.data.clientMessageId,
    })
    return { ok: true, data: item, error: null }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error:
        err instanceof Error ? err.message : "Gagal mengirim pesan obrolan.",
    }
  }
}

export async function deleteOwnChatMessageAction(input: {
  messageId: string
}): Promise<ChatActionResult<ChatMessageItem>> {
  const parsed = deleteOwnChatMessageSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, data: null, error: "ID pesan tidak valid." }
  }

  const auth = await resolveAnyOperationalChatContext()
  if (auth.status === "unauthenticated") {
    return { ok: false, data: null, error: "Sesi login Anda telah berakhir." }
  }
  if (auth.status === "forbidden") {
    return {
      ok: false,
      data: null,
      error: "Anda tidak memiliki akses pada ruang obrolan RT ini.",
    }
  }

  try {
    const supabase = await createClient()
    const item = await deleteOwnChatMessageWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      messageId: parsed.data.messageId,
    })
    return { ok: true, data: item, error: null }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Gagal menghapus pesan.",
    }
  }
}

export async function moderateChatMessageAction(input: {
  messageId: string
  action: "hide" | "restore"
  reason?: string
}): Promise<ChatActionResult<ChatMessageItem>> {
  const parsed = moderateChatMessageSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      data: null,
      error:
        parsed.error.issues[0]?.message ?? "Data moderasi pesan tidak valid.",
    }
  }

  const auth = await resolveScopedChatContext("admin")
  if (auth.status === "unauthenticated") {
    return { ok: false, data: null, error: "Sesi login Anda telah berakhir." }
  }
  if (auth.status === "forbidden") {
    return {
      ok: false,
      data: null,
      error:
        "Hanya Ketua RT, Sekretaris, atau Pengurus yang berwenang memoderasi pesan.",
    }
  }

  try {
    const supabase = await createClient()
    const item = await moderateChatMessageWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      messageId: parsed.data.messageId,
      action: parsed.data.action,
      reason: parsed.data.reason,
    })
    return { ok: true, data: item, error: null }
  } catch (err) {
    return {
      ok: false,
      data: null,
      error:
        err instanceof Error ? err.message : "Gagal memoderasi pesan obrolan.",
    }
  }
}

