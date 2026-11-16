"use server"

import { revalidatePath } from "next/cache"

import {
  resolveScopedFeedContext,
  type ScopedCommunityFeedContext,
} from "@/lib/community-feed/queries"
import {
  createCommunityPostCommentWithClient,
  createCommunityPostWithClient,
  dismissCommunityReportWithClient,
  moderateCommunityContentWithClient,
  reportCommunityContentWithClient,
  softDeleteCommunityPostCommentWithClient,
  softDeleteCommunityPostWithClient,
  toggleCommunityPostLikeWithClient,
  updateCommunityPostCommentWithClient,
  updateCommunityPostWithClient,
} from "@/lib/community-feed/repository"
import { CommunityFeedServiceError } from "@/lib/community-feed/errors"
import {
  communityUuidSchema,
  type CreateCommunityCommentInput,
  type CreateCommunityPostInput,
  type DismissCommunityReportInput,
  type ModerateCommunityContentInput,
  type ReportCommunityContentInput,
  type ToggleCommunityPostLikeInput,
  type UpdateCommunityCommentInput,
  type UpdateCommunityPostInput,
} from "@/lib/community-feed/schemas"
import type {
  CommunityActionErrorCode,
  CommunityActionResult,
  CommunityCommentItem,
  CommunityFeedScope,
  CommunityModerationStatus,
  CommunityPostItem,
  CommunityReportTargetType,
} from "@/lib/community-feed/types"
import { createClient } from "@/lib/supabase/server"

function revalidateCommunityFeedPaths(scope: "resident" | "admin") {
  if (scope === "resident") {
    revalidatePath("/resident/feed")
  } else {
    revalidatePath("/komunitas")
    revalidatePath("/resident/feed")
  }
}

function failAction<T>(
  code: CommunityActionErrorCode,
  error: string,
  fieldErrors?: Record<string, string[] | undefined>
): CommunityActionResult<T> {
  return {
    ok: false,
    data: null,
    error,
    code,
    ...(fieldErrors ? { fieldErrors } : {}),
  }
}

function mapActionException<T>(
  err: unknown,
  fallbackMessage: string
): CommunityActionResult<T> {
  if (err instanceof CommunityFeedServiceError) {
    return failAction<T>(err.code, err.message)
  }
  return failAction<T>("INTERNAL_ERROR", fallbackMessage)
}

async function requireScopedActionContext(
  scope: CommunityFeedScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedCommunityFeedContext }
  | { ok: false; response: CommunityActionResult<never> }
> {
  const resolved = await resolveScopedFeedContext(scope)
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: failAction(
        "UNAUTHORIZED",
        "Sesi login Anda telah berakhir. Silakan masuk kembali."
      ),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: failAction("FORBIDDEN", forbiddenMessage),
    }
  }
  return { ok: true, context: resolved.context }
}

export async function createCommunityPostAction(
  input: CreateCommunityPostInput
): Promise<CommunityActionResult<CommunityPostItem>> {
  const auth = await requireScopedActionContext(
    "resident",
    "Hanya warga aktif yang dapat membuat postingan feed komunitas."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const post = await createCommunityPostWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      viewerMemberId: auth.context.tenant.memberId,
      input,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: post, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal membuat postingan. Silakan coba lagi.")
  }
}

export async function updateCommunityPostAction(
  input: UpdateCommunityPostInput
): Promise<CommunityActionResult<CommunityPostItem>> {
  const auth = await requireScopedActionContext(
    "resident",
    "Hanya warga aktif yang dapat mengubah postingan feed komunitas."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const post = await updateCommunityPostWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      viewerMemberId: auth.context.tenant.memberId,
      input,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: post, error: null }
  } catch (err) {
    return mapActionException(
      err,
      "Gagal memperbarui postingan. Silakan coba lagi."
    )
  }
}

export async function softDeleteCommunityPostAction(
  input: unknown
): Promise<CommunityActionResult<{ postId: string; deleted: true }>> {
  const parsed = communityUuidSchema.safeParse(
    (input as { postId?: unknown } | null)?.postId
  )
  if (!parsed.success) {
    return failAction("VALIDATION_ERROR", "ID postingan tidak valid.")
  }

  const auth = await requireScopedActionContext(
    "resident",
    "Hanya penulis postingan yang dapat menghapus postingan ini."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await softDeleteCommunityPostWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      postId: parsed.data,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal menghapus postingan. Silakan coba lagi.")
  }
}

export async function toggleCommunityPostLikeAction(
  input: ToggleCommunityPostLikeInput
): Promise<
  CommunityActionResult<{ postId: string; liked: boolean; likeCount: number }>
> {
  const auth = await requireScopedActionContext(
    "resident",
    "Hanya warga aktif yang dapat menyukai postingan feed komunitas."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await toggleCommunityPostLikeWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      input,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal memproses suka. Silakan coba lagi.")
  }
}

export async function createCommunityPostCommentAction(
  input: CreateCommunityCommentInput
): Promise<
  CommunityActionResult<{ comment: CommunityCommentItem; commentCount: number }>
> {
  const auth = await requireScopedActionContext(
    "resident",
    "Hanya warga aktif yang dapat mengirim komentar."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await createCommunityPostCommentWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      viewerMemberId: auth.context.tenant.memberId,
      input,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal mengirim komentar. Silakan coba lagi.")
  }
}

export async function updateCommunityPostCommentAction(
  input: UpdateCommunityCommentInput
): Promise<CommunityActionResult<CommunityCommentItem>> {
  const auth = await requireScopedActionContext(
    "resident",
    "Hanya penulis komentar yang dapat mengubah komentar ini."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const comment = await updateCommunityPostCommentWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      viewerMemberId: auth.context.tenant.memberId,
      input,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: comment, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal memperbarui komentar. Silakan coba lagi.")
  }
}

export async function softDeleteCommunityPostCommentAction(
  input: unknown
): Promise<
  CommunityActionResult<{
    commentId: string
    postId: string
    commentCount: number
  }>
> {
  const parsed = communityUuidSchema.safeParse(
    (input as { commentId?: unknown } | null)?.commentId
  )
  if (!parsed.success) {
    return failAction("VALIDATION_ERROR", "ID komentar tidak valid.")
  }

  const auth = await requireScopedActionContext(
    "resident",
    "Hanya penulis komentar yang dapat menghapus komentar ini."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await softDeleteCommunityPostCommentWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      commentId: parsed.data,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal menghapus komentar. Silakan coba lagi.")
  }
}

export async function reportCommunityContentAction(
  input: ReportCommunityContentInput
): Promise<CommunityActionResult<{ reportId: string }>> {
  const auth = await requireScopedActionContext(
    "resident",
    "Hanya warga aktif yang dapat melaporkan konten feed komunitas."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await reportCommunityContentWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      input,
    })
    revalidateCommunityFeedPaths("resident")
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal mengirim laporan. Silakan coba lagi.")
  }
}

export async function moderateCommunityContentAction(
  input: ModerateCommunityContentInput
): Promise<
  CommunityActionResult<{
    targetType: CommunityReportTargetType
    targetId: string
    moderationStatus: CommunityModerationStatus
  }>
> {
  const auth = await requireScopedActionContext(
    "admin",
    "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat memoderasi konten feed."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await moderateCommunityContentWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      roles: auth.context.tenant.roles,
      input,
    })
    revalidateCommunityFeedPaths("admin")
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal memoderasi konten. Silakan coba lagi.")
  }
}

export async function dismissCommunityReportAction(
  input: DismissCommunityReportInput
): Promise<CommunityActionResult<{ reportId: string; status: "dismissed" }>> {
  const auth = await requireScopedActionContext(
    "admin",
    "Hanya Ketua RT, Sekretaris, atau Pengurus yang dapat menolak laporan."
  )
  if (!auth.ok) return auth.response

  try {
    const supabase = await createClient()
    const result = await dismissCommunityReportWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      roles: auth.context.tenant.roles,
      input,
    })
    revalidateCommunityFeedPaths("admin")
    return { ok: true, data: result, error: null }
  } catch (err) {
    return mapActionException(err, "Gagal menolak laporan. Silakan coba lagi.")
  }
}
