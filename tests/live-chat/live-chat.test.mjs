import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"

const require = createRequire(import.meta.url)
const ts = require("typescript")

const ROOT = process.cwd()
const OUT_DIR = `/tmp/smart-rt-live-chat-test-dist-${process.pid}`

const SOURCE_FILES = [
  "src/lib/residents/schemas.ts",
  "src/lib/live-chat/types.ts",
  "src/lib/live-chat/schemas.ts",
  "src/lib/live-chat/repository.ts",
]

function loadLiveChatModules() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  try {
    symlinkSync(
      resolve(ROOT, "node_modules"),
      join(OUT_DIR, "node_modules"),
      "dir"
    )
  } catch {
    // ignore
  }

  for (const relPath of SOURCE_FILES) {
    const absIn = resolve(ROOT, relPath)
    const sourceText = readFileSync(absIn, "utf8")
    const result = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      fileName: absIn,
    })

    const outPath = join(
      OUT_DIR,
      relPath.replace(/^src\//, "").replace(/\.ts$/, ".js")
    )
    mkdirSync(dirname(outPath), { recursive: true })

    const depth = relPath.replace(/^src\//, "").split("/").length - 1
    const prefix = depth > 0 ? "../".repeat(depth) : "./"
    const rewritten = result.outputText.replace(
      /require\(["']@\/(.*?)["']\)/g,
      (_match, sub) => `require("${prefix}${sub}")`
    )
    writeFileSync(outPath, rewritten, "utf8")
  }

  return {
    types: require(join(OUT_DIR, "lib/live-chat/types.js")),
    schemas: require(join(OUT_DIR, "lib/live-chat/schemas.js")),
    repository: require(join(OUT_DIR, "lib/live-chat/repository.js")),
  }
}

const { types, schemas, repository } = loadLiveChatModules()

const UUID_1 = "11111111-1111-4111-8111-111111111111"
const UUID_2 = "22222222-2222-4222-8222-222222222222"
const UUID_3 = "33333333-3333-4333-8333-333333333333"
const UUID_4 = "44444444-4444-4444-8444-444444444444"

test("canModerateLiveChat authorizes ketua_rt, sekretaris, pengurus and denies bendahara & warga", () => {
  assert.equal(types.canModerateLiveChat(["ketua_rt"]), true)
  assert.equal(types.canModerateLiveChat(["sekretaris"]), true)
  assert.equal(types.canModerateLiveChat(["pengurus"]), true)
  assert.equal(types.canModerateLiveChat(["warga", "pengurus"]), true)

  assert.equal(types.canModerateLiveChat(["bendahara"]), false)
  assert.equal(types.canModerateLiveChat(["warga"]), false)
  assert.equal(types.canModerateLiveChat([]), false)
})

test("sendChatMessageSchema validates roomId, trimmed content length, and optional clientMessageId", () => {
  const valid = schemas.sendChatMessageSchema.safeParse({
    roomId: UUID_1,
    content: "  Halo warga RT 04!  ",
    clientMessageId: UUID_2,
  })
  assert.equal(valid.success, true)
  assert.equal(valid.data.content, "Halo warga RT 04!")

  const empty = schemas.sendChatMessageSchema.safeParse({
    roomId: UUID_1,
    content: "   ",
  })
  assert.equal(empty.success, false)

  const tooLong = schemas.sendChatMessageSchema.safeParse({
    roomId: UUID_1,
    content: "a".repeat(2001),
  })
  assert.equal(tooLong.success, false)

  const badUuid = schemas.sendChatMessageSchema.safeParse({
    roomId: "not-a-uuid",
    content: "Halo",
  })
  assert.equal(badUuid.success, false)
})

test("moderateChatMessageSchema requires >=3 char reason when hiding and accepts restore without reason", () => {
  const hideMissingReason = schemas.moderateChatMessageSchema.safeParse({
    messageId: UUID_1,
    action: "hide",
    reason: "ab",
  })
  assert.equal(hideMissingReason.success, false)

  const hideValid = schemas.moderateChatMessageSchema.safeParse({
    messageId: UUID_1,
    action: "hide",
    reason: "Mengandung kata kasar",
  })
  assert.equal(hideValid.success, true)

  const restoreValid = schemas.moderateChatMessageSchema.safeParse({
    messageId: UUID_1,
    action: "restore",
  })
  assert.equal(restoreValid.success, true)
})

test("chatHistoryQuerySchema validates cursor and clamps/defaults limit", () => {
  const defaulted = schemas.chatHistoryQuerySchema.safeParse({
    roomId: UUID_1,
  })
  assert.equal(defaulted.success, true)
  assert.equal(defaulted.data.limit, 30)

  const withCursor = schemas.chatHistoryQuerySchema.safeParse({
    roomId: UUID_1,
    before: "2026-11-17T10:00:00.000Z",
    limit: "50",
  })
  assert.equal(withCursor.success, true)
  assert.equal(withCursor.data.limit, 50)

  const overLimit = schemas.chatHistoryQuerySchema.safeParse({
    roomId: UUID_1,
    limit: "100",
  })
  assert.equal(overLimit.success, false)
})

test("mapRawChatMessage masks moderated content for residents while preserving original text for admin", () => {
  const hiddenRow = {
    id: UUID_1,
    tenant_id: UUID_2,
    room_id: UUID_3,
    sender_user_id: UUID_4,
    sender_member_id: UUID_4,
    sender_name: "Budi Santoso",
    sender_role_badge: "Warga",
    content: "Isi pesan asli yang sensitif",
    client_message_id: null,
    moderation_status: "hidden_by_moderator",
    moderation_reason: "Spam",
    created_at: "2026-11-17T10:00:00Z",
    updated_at: "2026-11-17T10:01:00Z",
    deleted_at: null,
  }

  const residentView = repository.mapRawChatMessage(hiddenRow, true)
  assert.equal(residentView.content, "Pesan ini disembunyikan oleh pengurus RT.")
  assert.equal(residentView.moderationStatus, "hidden_by_moderator")

  const adminView = repository.mapRawChatMessage(hiddenRow, false)
  assert.equal(adminView.content, "Isi pesan asli yang sensitif")

  const deletedRow = {
    ...hiddenRow,
    moderation_status: "deleted_by_sender",
    deleted_at: "2026-11-17T10:02:00Z",
  }
  const deletedAdmin = repository.mapRawChatMessage(deletedRow, false)
  assert.equal(deletedAdmin.content, "Pesan ini telah dihapus oleh pengirim.")
})

test("mergeRealtimeMessage deduplicates by id and clientMessageId and preserves chronological order", () => {
  const m1 = {
    id: UUID_1,
    tenantId: UUID_4,
    roomId: UUID_4,
    senderUserId: UUID_2,
    senderMemberId: UUID_2,
    senderName: "Warga A",
    senderRoleBadge: "Warga",
    content: "Selamat pagi",
    clientMessageId: UUID_3,
    moderationStatus: "published",
    moderationReason: null,
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    deletedAt: null,
  }
  const m2 = {
    ...m1,
    id: UUID_2,
    clientMessageId: null,
    content: "Pagi juga!",
    createdAt: "2026-11-17T10:01:00.000Z",
    updatedAt: "2026-11-17T10:01:00.000Z",
  }

  let list = repository.mergeRealtimeMessage([], m2)
  list = repository.mergeRealtimeMessage(list, m1)
  assert.equal(list.length, 2)
  assert.equal(list[0].id, UUID_1)
  assert.equal(list[1].id, UUID_2)

  // Duplicate INSERT by id should replace cleanly, not append
  const m1Updated = {
    ...m1,
    moderationStatus: "hidden_by_moderator",
    content: "Pesan ini disembunyikan oleh pengurus RT.",
  }
  list = repository.mergeRealtimeMessage(list, m1Updated)
  assert.equal(list.length, 2)
  assert.equal(list[0].moderationStatus, "hidden_by_moderator")

  // Duplicate by clientMessageId + senderUserId should replace without duplication
  const m1Echo = { ...m1, content: "Selamat pagi (echo)" }
  list = repository.mergeRealtimeMessage(list, m1Echo)
  assert.equal(list.length, 2)
})

test("prependOlderMessages deduplicates overlapping pages and sorts ascending", () => {
  const base = {
    tenantId: UUID_4,
    roomId: UUID_4,
    senderUserId: UUID_2,
    senderMemberId: UUID_2,
    senderName: "Warga A",
    senderRoleBadge: "Warga",
    clientMessageId: null,
    moderationStatus: "published",
    moderationReason: null,
    deletedAt: null,
  }
  const older1 = {
    ...base,
    id: UUID_1,
    content: "Pesan 1",
    createdAt: "2026-11-17T08:00:00.000Z",
    updatedAt: "2026-11-17T08:00:00.000Z",
  }
  const overlap = {
    ...base,
    id: UUID_2,
    content: "Pesan 2",
    createdAt: "2026-11-17T09:00:00.000Z",
    updatedAt: "2026-11-17T09:00:00.000Z",
  }
  const newest = {
    ...base,
    id: UUID_3,
    content: "Pesan 3",
    createdAt: "2026-11-17T10:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
  }

  const merged = repository.prependOlderMessages([overlap, newest], [older1, overlap])
  assert.equal(merged.length, 3)
  assert.deepEqual(
    merged.map((m) => m.id),
    [UUID_1, UUID_2, UUID_3]
  )
})

test("listChatMessagesWithClient only queries moderation vault in admin view", async () => {
  const queriedTables = []
  const scrubbedRow = {
    id: UUID_1,
    tenant_id: UUID_2,
    room_id: UUID_3,
    sender_user_id: UUID_4,
    sender_member_id: UUID_4,
    sender_name: "Budi Santoso",
    sender_role_badge: "Warga",
    content: "Pesan ini disembunyikan oleh pengurus RT.",
    client_message_id: null,
    moderation_status: "hidden_by_moderator",
    moderation_reason: "Mengandung kata kasar",
    created_at: "2026-11-17T10:00:00Z",
    updated_at: "2026-11-17T10:01:00Z",
    deleted_at: "2026-11-17T10:01:00Z",
  }

  const fakeClient = {
    from(table) {
      queriedTables.push(table)
      if (table === "chat_messages") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          lt: () => chain,
          limit: async () => ({ data: [scrubbedRow], error: null }),
        }
        return chain
      }
      if (table === "chat_message_moderation_vault") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: async () => ({
            data: [
              {
                message_id: UUID_1,
                original_content: "Teks asli yang harus dilindungi",
              },
            ],
            error: null,
          }),
        }
        return chain
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }

  const residentPage = await repository.listChatMessagesWithClient(fakeClient, {
    tenantId: UUID_2,
    roomId: UUID_3,
    maskModeratedContent: true,
  })
  assert.equal(queriedTables.includes("chat_message_moderation_vault"), false)
  assert.equal(
    residentPage.items[0].content,
    "Pesan ini disembunyikan oleh pengurus RT."
  )

  const adminPage = await repository.listChatMessagesWithClient(fakeClient, {
    tenantId: UUID_2,
    roomId: UUID_3,
    maskModeratedContent: false,
  })
  assert.equal(queriedTables.includes("chat_message_moderation_vault"), true)
  assert.equal(adminPage.items[0].content, "Teks asli yang harus dilindungi")
})

test("moderateChatMessageWithClient restores original text from vault for admin UI when hiding", async () => {
  const scrubbedRow = {
    id: UUID_1,
    tenant_id: UUID_2,
    room_id: UUID_3,
    sender_user_id: UUID_4,
    sender_member_id: UUID_4,
    sender_name: "Budi Santoso",
    sender_role_badge: "Warga",
    content: "Pesan ini disembunyikan oleh pengurus RT.",
    client_message_id: null,
    moderation_status: "hidden_by_moderator",
    moderation_reason: "Spam",
    created_at: "2026-11-17T10:00:00Z",
    updated_at: "2026-11-17T10:01:00Z",
    deleted_at: "2026-11-17T10:01:00Z",
  }

  const fakeClient = {
    rpc: async () => ({ data: scrubbedRow, error: null }),
    from(table) {
      assert.equal(table, "chat_message_moderation_vault")
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { original_content: "Konten rahasia sebelum di-hide" },
          error: null,
        }),
      }
      return chain
    },
  }

  const moderated = await repository.moderateChatMessageWithClient(fakeClient, {
    tenantId: UUID_2,
    messageId: UUID_1,
    action: "hide",
    reason: "Spam",
  })
  assert.equal(moderated.moderationStatus, "hidden_by_moderator")
  assert.equal(moderated.content, "Konten rahasia sebelum di-hide")
})


