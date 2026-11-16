"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type {
  AdminDashboardAnalyticsData,
  AnalyticsActivityCategory,
  AnalyticsFilterInput,
} from "@/lib/analytics/types"

export interface AdminAnalyticsQueryParams extends AnalyticsFilterInput {
  activityCategory: AnalyticsActivityCategory
  activityPage: number
  activityPageSize: number
}

export function buildAnalyticsQueryString(
  params: Partial<AdminAnalyticsQueryParams>
): string {
  const sp = new URLSearchParams()
  if (params.periodMode) sp.set("periodMode", params.periodMode)
  if (params.year) sp.set("year", String(params.year))
  if (params.month) sp.set("month", String(params.month))
  if (params.startDate) sp.set("startDate", params.startDate)
  if (params.endDate) sp.set("endDate", params.endDate)
  if (params.activityCategory) {
    sp.set("activityCategory", params.activityCategory)
  }
  if (params.activityPage) sp.set("activityPage", String(params.activityPage))
  if (params.activityPageSize) {
    sp.set("activityPageSize", String(params.activityPageSize))
  }
  return sp.toString()
}

export function useAdminAnalytics({
  tenantId,
  params,
  initialData,
  isInitialKey,
}: {
  tenantId: string
  params: AdminAnalyticsQueryParams
  initialData: AdminDashboardAnalyticsData
  isInitialKey: boolean
}) {
  const qs = buildAnalyticsQueryString(params)

  return useQuery<AdminDashboardAnalyticsData, Error>({
    queryKey: ["analytics", "admin", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/admin?${qs}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(body?.error ?? "Gagal memuat data analitik dashboard.")
      }
      return (await res.json()) as AdminDashboardAnalyticsData
    },
    initialData: isInitialKey ? initialData : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })
}

