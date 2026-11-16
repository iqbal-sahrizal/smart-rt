"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query"

import {
  markAllNotificationsAsReadAction,
  markNotificationAsReadAction,
} from "@/app/actions/notifications"
import type {
  NotificationCursor,
  NotificationFilter,
  NotificationListPage,
  NotificationScope,
  NotificationSummary,
} from "@/lib/notifications/types"

export const notificationQueryKeys = {
  all: (scope: NotificationScope, tenantId?: string) =>
    ["notifications", scope, tenantId ?? "active"] as const,
  summary: (scope: NotificationScope, tenantId?: string) =>
    ["notifications", scope, tenantId ?? "active", "summary"] as const,
  list: (
    scope: NotificationScope,
    tenantId: string | undefined,
    filter: NotificationFilter
  ) =>
    ["notifications", scope, tenantId ?? "active", "list", filter] as const,
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null
    throw new Error(body?.error ?? "Gagal memuat notifikasi.")
  }

  return (await response.json()) as T
}

export function useNotificationSummary({
  scope,
  tenantId,
  enabled = true,
}: {
  scope: NotificationScope
  tenantId?: string
  enabled?: boolean
}) {
  return useQuery<NotificationSummary, Error>({
    queryKey: notificationQueryKeys.summary(scope, tenantId),
    queryFn: () =>
      fetchJson<NotificationSummary>(
        `/api/notifications?scope=${scope}&mode=summary&limit=6`
      ),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useNotificationsInfiniteList({
  scope,
  tenantId,
  filter,
  initialPage,
  initialFilter = "all",
  pageSize = 15,
}: {
  scope: NotificationScope
  tenantId?: string
  filter: NotificationFilter
  initialPage?: NotificationListPage
  initialFilter?: NotificationFilter
  pageSize?: number
}) {
  const hasMatchingInitial = Boolean(initialPage && filter === initialFilter)

  return useInfiniteQuery<
    NotificationListPage,
    Error,
    InfiniteData<NotificationListPage, NotificationCursor | null>,
    ReturnType<typeof notificationQueryKeys.list>,
    NotificationCursor | null
  >({
    queryKey: notificationQueryKeys.list(scope, tenantId, filter),
    initialPageParam: null,
    initialData: hasMatchingInitial && initialPage
      ? {
          pages: [initialPage],
          pageParams: [null],
        }
      : undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        scope,
        mode: "list",
        filter,
        limit: String(pageSize),
      })
      if (pageParam) {
        params.set("cursorCreatedAt", pageParam.createdAt)
        params.set("cursorId", pageParam.id)
      }
      return fetchJson<NotificationListPage>(
        `/api/notifications?${params.toString()}`
      )
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function useMarkNotificationReadMutation({
  scope,
  tenantId,
}: {
  scope: NotificationScope
  tenantId?: string
}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const result = await markNotificationAsReadAction({
        notificationId,
        scope,
      })
      if (!result.ok) {
        throw new Error(
          result.error ?? "Gagal menandai notifikasi sebagai sudah dibaca."
        )
      }
      return result
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: notificationQueryKeys.all(scope, tenantId),
      })
    },
  })
}

export function useMarkAllNotificationsReadMutation({
  scope,
  tenantId,
}: {
  scope: NotificationScope
  tenantId?: string
}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const result = await markAllNotificationsAsReadAction({ scope })
      if (!result.ok) {
        throw new Error(
          result.error ?? "Gagal menandai semua notifikasi sebagai sudah dibaca."
        )
      }
      return result
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: notificationQueryKeys.all(scope, tenantId),
      })
    },
  })
}

