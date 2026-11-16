import assert from "node:assert/strict"
import test from "node:test"

import { loadCommunityFeedTestModules } from "./helpers/load-community-feed-modules.mjs"

const { constants, types, errors, schemas, storage, formatters, queryKeys } =
  loadCommunityFeedTestModules()

const VALID_TENANT = "11111111-1111-4111-8111-111111111101"
const VALID_MEMBER = "22222222-2222-4222-8222-222222222202"
const OTHER_MEMBER = "33333333-3333-4333-8333-333333333303"
const VALID_POST = "44444444-4444-4444-8444-444444444404"

function makeJpegBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0xff, 0xd8, 0xff, 0xe0], 0)
  return buf
}

function makePngBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return buf
}

function makeWebpBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0)
  return buf
}

function makePdfBytes(size = 32) {
  const buf = new Uint8Array(size)
  buf.set(new TextEncoder().encode("%PDF-1.4\n"), 0)
  return buf
}

test("Community Feed moderation role matrix: only ketua_rt, sekretaris, pengurus may moderate (never bendahara/warga)", () => {
  assert.equal(types.canModerateCommunityFeed(["ketua_rt"]), true)
  assert.equal(types.canModerateCommunityFeed(["sekretaris"]), true)
  assert.equal(types.canModerateCommunityFeed(["pengurus"]), true)
  assert.equal(types.canModerateCommunityFeed(["bendahara"]), false)
  assert.equal(types.canModerateCommunityFeed(["warga"]), false)
  assert.equal(types.canModerateCommunityFeed([]), false)
  assert.equal(
    types.canModerateCommunityFeed(["bendahara", "warga"]),
    false
  )
  assert.equal(types.canModerateCommunityFeed(["warga", "pengurus"]), true)
})

test("createCommunityPostSchema requires caption or media, trims caption, enforces max media count and lengths", () => {
  const emptyPost = schemas.createCommunityPostSchema.safeParse({})
  assert.equal(emptyPost.success, false)

  const captionOnly = schemas.createCommunityPostSchema.safeParse({
    caption: "  Kerja bakti minggu ini sukses!  ",
  })
  assert.equal(captionOnly.success, true)
  assert.equal(captionOnly.data.caption, "Kerja bakti minggu ini sukses!")
  assert.equal(captionOnly.data.mediaItems.length, 0)

  const mediaOnly = schemas.createCommunityPostSchema.safeParse({
    mediaItems: [
      {
        storagePath: `${VALID_TENANT}/${VALID_MEMBER}/${VALID_POST}.jpg`,
        mimeType: "image/jpeg",
        fileSizeBytes: 1024,
      },
    ],
  })
  assert.equal(mediaOnly.success, true)

  const tooManyMedia = schemas.createCommunityPostSchema.safeParse({
    mediaItems: Array.from({ length: 5 }, (_, i) => ({
      storagePath: `${VALID_TENANT}/${VALID_MEMBER}/${VALID_POST}-${i}.jpg`,
      mimeType: "image/jpeg",
      fileSizeBytes: 1024,
    })),
  })
  assert.equal(tooManyMedia.success, false)

  const captionTooLong = schemas.createCommunityPostSchema.safeParse({
    caption: "a".repeat(constants.MAX_COMMUNITY_CAPTION_LENGTH + 1),
  })
  assert.equal(captionTooLong.success, false)

  const oversizedMedia = schemas.createCommunityPostSchema.safeParse({
    mediaItems: [
      {
        storagePath: `${VALID_TENANT}/${VALID_MEMBER}/${VALID_POST}.jpg`,
        mimeType: "image/jpeg",
        fileSizeBytes: constants.MAX_COMMUNITY_IMAGE_BYTES + 1,
      },
    ],
  })
  assert.equal(oversizedMedia.success, false)

  const badMime = schemas.createCommunityPostSchema.safeParse({
    mediaItems: [
      {
        storagePath: `${VALID_TENANT}/${VALID_MEMBER}/${VALID_POST}.gif`,
        mimeType: "image/gif",
        fileSizeBytes: 1024,
      },
    ],
  })
  assert.equal(badMime.success, false)
})

test("updateCommunityPostSchema validates postId, media caps, and rejects empty result", () => {
  const invalidId = schemas.updateCommunityPostSchema.safeParse({
    postId: "not-a-uuid",
    caption: "Halo",
  })
  assert.equal(invalidId.success, false)

  const emptyResult = schemas.updateCommunityPostSchema.safeParse({
    postId: VALID_POST,
    caption: null,
    keepMediaIds: [],
    newMediaItems: [],
  })
  assert.equal(emptyResult.success, false)

  const valid = schemas.updateCommunityPostSchema.safeParse({
    postId: VALID_POST,
    caption: "Diperbarui",
    keepMediaIds: [VALID_MEMBER],
  })
  assert.equal(valid.success, true)
})

test("toggleLikeSchema and createCommentSchema enforce UUID and content-length bounds", () => {
  assert.equal(
    schemas.toggleLikeSchema.safeParse({ postId: VALID_POST }).success,
    true
  )
  assert.equal(
    schemas.toggleLikeSchema.safeParse({ postId: "bad" }).success,
    false
  )

  const emptyComment = schemas.createCommentSchema.safeParse({
    postId: VALID_POST,
    content: "   ",
  })
  assert.equal(emptyComment.success, false)

  const tooLongComment = schemas.createCommentSchema.safeParse({
    postId: VALID_POST,
    content: "a".repeat(constants.MAX_COMMUNITY_COMMENT_LENGTH + 1),
  })
  assert.equal(tooLongComment.success, false)

  const validComment = schemas.createCommentSchema.safeParse({
    postId: VALID_POST,
    content: "Mantap kerja baktinya!",
  })
  assert.equal(validComment.success, true)
})

test("reportContentSchema restricts categories and moderateContentSchema requires a reason to hide content", () => {
  const badCategory = schemas.reportContentSchema.safeParse({
    targetType: "post",
    targetId: VALID_POST,
    reasonCategory: "not-a-real-category",
  })
  assert.equal(badCategory.success, false)

  const validReport = schemas.reportContentSchema.safeParse({
    targetType: "post",
    targetId: VALID_POST,
    reasonCategory: "spam",
  })
  assert.equal(validReport.success, true)

  const hideWithoutReason = schemas.moderateContentSchema.safeParse({
    targetType: "post",
    targetId: VALID_POST,
    action: "hide",
  })
  assert.equal(hideWithoutReason.success, false)

  const hideTooShortReason = schemas.moderateContentSchema.safeParse({
    targetType: "post",
    targetId: VALID_POST,
    action: "hide",
    reason: "ab",
  })
  assert.equal(hideTooShortReason.success, false)

  const hideWithReason = schemas.moderateContentSchema.safeParse({
    targetType: "post",
    targetId: VALID_POST,
    action: "hide",
    reason: "Melanggar ketentuan komunitas RT.",
  })
  assert.equal(hideWithReason.success, true)

  const restoreWithoutReason = schemas.moderateContentSchema.safeParse({
    targetType: "post",
    targetId: VALID_POST,
    action: "restore",
  })
  assert.equal(restoreWithoutReason.success, true)
})

test("feedListQuerySchema and commentsListQuerySchema clamp pagination bounds", () => {
  const over = schemas.feedListQuerySchema.safeParse({
    limit: constants.COMMUNITY_FEED_MAX_LIMIT + 50,
  })
  assert.equal(over.success, false)

  const coerced = schemas.feedListQuerySchema.safeParse({ limit: "5" })
  assert.equal(coerced.success, true)
  assert.equal(coerced.data.limit, 5)

  const badOffset = schemas.commentsListQuerySchema.safeParse({
    postId: VALID_POST,
    offset: -1,
  })
  assert.equal(badOffset.success, false)
})

test("Community media storage paths are strictly tenant/member/file-scoped UUID triples", () => {
  const goodPath = `${VALID_TENANT}/${VALID_MEMBER}/${VALID_POST}.jpg`
  assert.equal(storage.isValidCommunityMediaPath(goodPath), true)
  assert.equal(
    storage.isValidCommunityMediaPath("not/a/valid/path.jpg"),
    false
  )
  assert.equal(
    storage.isValidCommunityMediaPath(`${VALID_TENANT}/${VALID_MEMBER}/${VALID_POST}.exe`),
    false
  )

  assert.equal(
    storage.communityMediaPathBelongsToTenant(goodPath, VALID_TENANT),
    true
  )
  assert.equal(
    storage.communityMediaPathBelongsToTenant(goodPath, OTHER_MEMBER),
    false
  )

  assert.equal(
    storage.communityMediaPathBelongsToMember(goodPath, VALID_TENANT, VALID_MEMBER),
    true
  )
  assert.equal(
    storage.communityMediaPathBelongsToMember(goodPath, VALID_TENANT, OTHER_MEMBER),
    false,
    "A path scoped to one member must never validate as belonging to another member"
  )

  const builtPath = storage.buildCommunityMediaPath(
    VALID_TENANT,
    VALID_MEMBER,
    "webp"
  )
  assert.equal(storage.isValidCommunityMediaPath(builtPath), true)
  assert.equal(
    storage.communityMediaPathBelongsToMember(builtPath, VALID_TENANT, VALID_MEMBER),
    true
  )

  assert.equal(
    storage.buildCommunityMediaApiUrl(VALID_POST),
    `/api/community-feed/media/${VALID_POST}`
  )
})

test("Community media MIME detection relies on binary magic bytes, not the declared Content-Type", async () => {
  for (const [ext, mime, bytes] of [
    ["jpg", "image/jpeg", makeJpegBytes()],
    ["png", "image/png", makePngBytes()],
    ["webp", "image/webp", makeWebpBytes()],
  ]) {
    const file = new File([bytes], `photo.${ext}`, { type: mime })
    const res = await storage.validateCommunityImageFile(file)
    assert.equal(res.ok, true, `${ext} must validate`)
    assert.equal(res.file.mimeType, mime)
  }

  // A PDF disguised as a PNG (spoofed declared MIME) must be rejected by signature inspection
  const spoofed = new File([makePdfBytes()], "fake.png", {
    type: "image/png",
  })
  const spoofedRes = await storage.validateCommunityImageFile(spoofed)
  assert.equal(spoofedRes.ok, false)

  // Oversized image rejected
  const oversized = new File(
    [new Uint8Array(constants.MAX_COMMUNITY_IMAGE_BYTES + 1)],
    "huge.jpg",
    { type: "image/jpeg" }
  )
  // Fill header so it would otherwise pass signature detection
  const bigBytes = await oversized.arrayBuffer()
  new Uint8Array(bigBytes).set([0xff, 0xd8, 0xff, 0xe0], 0)
  const oversizedFile = new File([bigBytes], "huge.jpg", {
    type: "image/jpeg",
  })
  const oversizedRes = await storage.validateCommunityImageFile(oversizedFile)
  assert.equal(oversizedRes.ok, false)

  // Empty file entry rejected
  const emptyRes = await storage.validateCommunityImageFile(null)
  assert.equal(emptyRes.ok, false)
})

test("mapCommunityFeedDbError translates Postgres error codes into safe user-facing action results", () => {
  assert.equal(
    errors.mapCommunityFeedDbError({ code: "28000" }).code,
    "UNAUTHORIZED"
  )
  assert.equal(
    errors.mapCommunityFeedDbError({ code: "42501" }).code,
    "FORBIDDEN"
  )
  assert.equal(
    errors.mapCommunityFeedDbError({ code: "P0002" }).code,
    "NOT_FOUND"
  )
  assert.equal(
    errors.mapCommunityFeedDbError({ code: "23505", message: "report already pending" })
      .code,
    "CONFLICT"
  )
  assert.equal(
    errors.mapCommunityFeedDbError({ code: "23503", message: "storage object missing" })
      .code,
    "MEDIA_ERROR"
  )
  assert.equal(
    errors.mapCommunityFeedDbError({ code: "22023", message: "reason is required" }).code,
    "VALIDATION_ERROR"
  )
  assert.equal(
    errors.mapCommunityFeedDbError({ code: "unknown" }).code,
    "INTERNAL_ERROR"
  )

  const serviceError = new errors.CommunityFeedServiceError(
    403,
    "FORBIDDEN",
    "nope"
  )
  assert.equal(serviceError.status, 403)
  assert.equal(serviceError.code, "FORBIDDEN")
})

test("Community Feed formatters render Indonesian relative time, file sizes, and compact counts", () => {
  const now = new Date()
  assert.equal(
    formatters.formatCommunityTimeAgo(now.toISOString()),
    "Baru saja"
  )
  assert.equal(
    formatters.formatCommunityTimeAgo(
      new Date(now.getTime() - 5 * 60_000).toISOString()
    ),
    "5 menit lalu"
  )
  assert.equal(
    formatters.formatCommunityTimeAgo(
      new Date(now.getTime() - 3 * 3600_000).toISOString()
    ),
    "3 jam lalu"
  )
  assert.equal(formatters.formatCommunityTimeAgo("not-a-date"), "")

  assert.equal(formatters.formatCommunityFileSize(512), "512 B")
  assert.equal(formatters.formatCommunityFileSize(2048), "2.0 KB")
  assert.equal(formatters.formatCommunityFileSize(5 * 1024 * 1024), "5.0 MB")

  assert.equal(formatters.formatCommunityCount(42), "42")
  assert.equal(formatters.formatCommunityCount(1500), "1.5rb")
  assert.equal(formatters.formatCommunityCount(2_500_000), "2.5jt")
})

test("getCommunityFeedMutationInvalidationKeys scopes invalidation strictly to the actor's tenant query space", () => {
  const keys = queryKeys.getCommunityFeedMutationInvalidationKeys({
    tenantId: VALID_TENANT,
    actorKey: VALID_MEMBER,
  })
  assert.deepEqual(keys, [["community-feed", VALID_TENANT, VALID_MEMBER]])
})
