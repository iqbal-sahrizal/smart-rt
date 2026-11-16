"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import {
  createCommunityPostAction,
  createCommunityPostCommentAction,
  dismissCommunityReportAction,
  moderateCommunityContentAction,
  reportCommunityContentAction,
  softDeleteCommunityPostAction,
  softDeleteCommunityPostCommentAction,
  toggleCommunityPostLikeAction,
  updateCommunityPostAction,
  updateCommunityPostCommentAction,
} from "@/app/actions/community-feed"
import {
  communityFeedQueryKeys,
  getCommunityFeedMutationInvalidationKeys,
} from "@/lib/community-feed/query-keys"
import type {
  CreateCommunityCommentInput,
  CreateCommunityPostInput,
  DismissCommunityReportInput,
  ModerateCommunityContentInput,
  ReportCommunityContentInput,
  ToggleCommunityPostLikeInput,
  UpdateCommunityCommentInput,
  UpdateCommunityPostInput,
} from "@/lib/community-feed/schemas"
import type {
  CommunityActionResult,
  CommunityCommentItem,
  CommunityCommentsPage,
  CommunityFeedPage,
  CommunityModerationDashboardData,
  CommunityPostItem,
} from "@/lib/community-feed/types"

export { communityFeedQueryKeys }

async function fetchCommunityFeedJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(body?.error ?? "Gagal memuat data feed komunitas.")
  }

  return (await res.json()) as T
}

function unwrapCommunityFeedAction<T>(result: CommunityActionResult<T>): T {
  if (!result.ok || result.data === null) {
    throw new Error(result.error ?? "Operasi feed komunitas gagal diproses.")
  }
  return result.data
}

export interface UploadCommunityMediaResult {
  storagePath: string
  mimeType: string
  fileSizeBytes: number
}

export async function uploadCommunityMediaFile(
  file: File
): Promise<UploadCommunityMediaResult> {
  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch("/api/community-feed/upload", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(body?.error ?? "Gagal mengunggah gambar.")
  }

  return (await res.json()) as UploadCommunityMediaResult
}

export async function cleanupOrphanCommunityMedia(
  paths: readonly string[]
): Promise<void> {
  if (paths.length === 0) return
  await fetch("/api/community-feed/upload", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
    credentials: "same-origin",
  }).catch(() => undefined)
}

export function useResidentCommunityFeed({
  tenantId,
  actorKey,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  initialData?: CommunityFeedPage
  enabled?: boolean
}) {
  return useInfiniteQuery<CommunityFeedPage, Error>({
    queryKey: communityFeedQueryKeys.residentFeed(tenantId, actorKey),
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as
        | { createdAt: string; id: string }
        | undefined
      const sp = new URLSearchParams()
      if (cursor) {
        sp.set("cursorCreatedAt", cursor.createdAt)
        sp.set("cursorId", cursor.id)
      }
      const qs = sp.toString()
      return fetchCommunityFeedJson<CommunityFeedPage>(
        `/api/community-feed${qs ? `?${qs}` : ""}`
      )
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: initialData
      ? { pages: [initialData], pageParams: [undefined] }
      : undefined,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function usePostComments({
  tenantId,
  actorKey,
  postId,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  postId: string
  initialData?: CommunityCommentsPage
  enabled?: boolean
}) {
  return useInfiniteQuery<CommunityCommentsPage, Error>({
    queryKey: communityFeedQueryKeys.postComments(tenantId, actorKey, postId),
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0
      return fetchCommunityFeedJson<CommunityCommentsPage>(
        `/api/community-feed/posts/${encodeURIComponent(postId)}/comments?offset=${offset}`
      )
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    initialData: initialData
      ? { pages: [initialData], pageParams: [0] }
      : undefined,
    enabled: Boolean(tenantId && actorKey && postId) && enabled,
    staleTime: 15_000,
  })
}

export function useAdminModerationDashboard({
  tenantId,
  actorKey,
  initialData,
  enabled = true,
}: {
  tenantId: string
  actorKey: string
  initialData?: CommunityModerationDashboardData
  enabled?: boolean
}) {
  return useQuery<CommunityModerationDashboardData, Error>({
    queryKey: communityFeedQueryKeys.adminModeration(tenantId, actorKey),
    queryFn: () =>
      fetchCommunityFeedJson<CommunityModerationDashboardData>(
        "/api/community-feed/moderation"
      ),
    initialData,
    enabled: Boolean(tenantId && actorKey) && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

function useInvalidateCommunityFeed(tenantId: string, actorKey: string) {
  const queryClient = useQueryClient()
  return async () => {
    const keys = getCommunityFeedMutationInvalidationKeys({
      tenantId,
      actorKey,
    })
    await Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
    )
  }
}

export function useCreateCommunityPostMutation(
  tenantId: string,
  actorKey: string
) {
  const invalidate = useInvalidateCommunityFeed(tenantId, actorKey)
  return useMutation<CommunityPostItem, Error, CreateCommunityPostInput>({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await createCommunityPostAction(input)),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export function useUpdateCommunityPostMutation(
  tenantId: string,
  actorKey: string
) {
  const invalidate = useInvalidateCommunityFeed(tenantId, actorKey)
  return useMutation<CommunityPostItem, Error, UpdateCommunityPostInput>({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await updateCommunityPostAction(input)),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export function useSoftDeleteCommunityPostMutation(
  tenantId: string,
  actorKey: string
) {
  const invalidate = useInvalidateCommunityFeed(tenantId, actorKey)
  return useMutation<
    { postId: string; deleted: true },
    Error,
    { postId: string }
  >({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await softDeleteCommunityPostAction(input)),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export function useToggleCommunityPostLikeMutation(
  tenantId: string,
  actorKey: string
) {
  const queryClient = useQueryClient()
  const queryKey = communityFeedQueryKeys.residentFeed(tenantId, actorKey)

  return useMutation<
    { postId: string; liked: boolean; likeCount: number },
    Error,
    ToggleCommunityPostLikeInput,
    { previous?: { pages: CommunityFeedPage[]; pageParams: unknown[] } }
  >({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await toggleCommunityPostLikeAction(input)),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<{
        pages: CommunityFeedPage[]
        pageParams: unknown[]
      }>(queryKey)

      if (previous) {
        const desired = variables.desiredLiked
        queryClient.setQueryData(queryKey, {
          ...previous,
          pages: previous.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => {
              if (item.id !== variables.postId) return item
              const nextLiked = desired ?? !item.likedByMe
              const delta = nextLiked === item.likedByMe ? 0 : nextLiked ? 1 : -1
              return {
                ...item,
                likedByMe: nextLiked,
                likeCount: Math.max(0, item.likeCount + delta),
              }
            }),
          })),
        })
      }

      return { previous }
    },
    onError: (_err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
}

export function useCreateCommunityCommentMutation(
  tenantId: string,
  actorKey: string
) {
  const queryClient = useQueryClient()
  return useMutation<
    { comment: CommunityCommentItem; commentCount: number },
    Error,
    CreateCommunityCommentInput
  >({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await createCommunityPostCommentAction(input)),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: communityFeedQueryKeys.residentFeed(tenantId, actorKey),
        }),
        queryClient.invalidateQueries({
          queryKey: communityFeedQueryKeys.postComments(
            tenantId,
            actorKey,
            variables.postId
          ),
        }),
      ])
    },
  })
}

export function useUpdateCommunityCommentMutation(
  tenantId: string,
  actorKey: string,
  postId: string
) {
  const queryClient = useQueryClient()
  return useMutation<CommunityCommentItem, Error, UpdateCommunityCommentInput>({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await updateCommunityPostCommentAction(input)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: communityFeedQueryKeys.postComments(
          tenantId,
          actorKey,
          postId
        ),
      })
    },
  })
}

export function useSoftDeleteCommunityCommentMutation(
  tenantId: string,
  actorKey: string,
  postId: string
) {
  const queryClient = useQueryClient()
  return useMutation<
    { commentId: string; postId: string; commentCount: number },
    Error,
    { commentId: string }
  >({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(
        await softDeleteCommunityPostCommentAction(input)
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: communityFeedQueryKeys.residentFeed(tenantId, actorKey),
        }),
        queryClient.invalidateQueries({
          queryKey: communityFeedQueryKeys.postComments(
            tenantId,
            actorKey,
            postId
          ),
        }),
      ])
    },
  })
}

export function useReportCommunityContentMutation(
  tenantId: string,
  actorKey: string
) {
  const invalidate = useInvalidateCommunityFeed(tenantId, actorKey)
  return useMutation<
    { reportId: string },
    Error,
    ReportCommunityContentInput
  >({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await reportCommunityContentAction(input)),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export function useModerateCommunityContentMutation(
  tenantId: string,
  actorKey: string
) {
  const invalidate = useInvalidateCommunityFeed(tenantId, actorKey)
  return useMutation<
    { targetType: string; targetId: string; moderationStatus: string },
    Error,
    ModerateCommunityContentInput
  >({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await moderateCommunityContentAction(input)),
    onSuccess: async () => {
      await invalidate()
    },
  })
}

export function useDismissCommunityReportMutation(
  tenantId: string,
  actorKey: string
) {
  const invalidate = useInvalidateCommunityFeed(tenantId, actorKey)
  return useMutation<
    { reportId: string; status: "dismissed" },
    Error,
    DismissCommunityReportInput
  >({
    mutationFn: async (input) =>
      unwrapCommunityFeedAction(await dismissCommunityReportAction(input)),
    onSuccess: async () => {
      await invalidate()
    },
  })
}
