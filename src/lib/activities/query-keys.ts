import type { QueryKey } from "@tanstack/react-query"

import type {
  ActivityListFilters,
  ActivityParticipantsFilters,
  ActivityScope,
} from "@/lib/activities/types"

export const activitiesQueryKeys = {
  all: (scope: ActivityScope, tenantId: string, actorKey: string) =>
    ["activities", scope, tenantId, actorKey] as const,
  lists: (scope: ActivityScope, tenantId: string, actorKey: string) =>
    ["activities", scope, tenantId, actorKey, "list"] as const,
  list: (
    scope: ActivityScope,
    tenantId: string,
    actorKey: string,
    filters?: ActivityListFilters
  ) =>
    [
      "activities",
      scope,
      tenantId,
      actorKey,
      "list",
      {
        status: filters?.status ?? null,
        category: filters?.category ?? null,
        search: filters?.search?.trim() ?? "",
        upcomingOnly: filters?.upcomingOnly ?? false,
        includeDeleted: filters?.includeDeleted ?? false,
        page: filters?.page ?? 1,
        pageSize: filters?.pageSize ?? 10,
        sortBy: filters?.sortBy ?? "start_at",
        sort: filters?.sort ?? "asc",
      },
    ] as const,
  details: (scope: ActivityScope, tenantId: string, actorKey: string) =>
    ["activities", scope, tenantId, actorKey, "detail"] as const,
  detail: (
    scope: ActivityScope,
    tenantId: string,
    actorKey: string,
    activityId: string
  ) => ["activities", scope, tenantId, actorKey, "detail", activityId] as const,
  participants: (
    tenantId: string,
    actorKey: string,
    activityId: string,
    filters?: ActivityParticipantsFilters
  ) =>
    [
      "activities",
      "admin",
      tenantId,
      actorKey,
      "participants",
      activityId,
      {
        rsvpStatus: filters?.rsvpStatus ?? null,
        search: filters?.search?.trim() ?? "",
        page: filters?.page ?? 1,
        pageSize: filters?.pageSize ?? 10,
      },
    ] as const,
  registration: (tenantId: string, actorKey: string, activityId: string) =>
    [
      "activities",
      "resident",
      tenantId,
      actorKey,
      "registration",
      activityId,
    ] as const,
  history: (
    tenantId: string,
    actorKey: string,
    page = 1,
    pageSize = 10
  ) =>
    [
      "activities",
      "resident",
      tenantId,
      actorKey,
      "history",
      { page, pageSize },
    ] as const,
}

export function getActivityMutationInvalidationKeys({
  tenantId,
  activityId,
  includeAnalytics = true,
}: {
  tenantId: string
  activityId?: string
  includeAnalytics?: boolean
}): QueryKey[] {
  const keys: QueryKey[] = [
    ["activities", "admin", tenantId],
    ["activities", "resident", tenantId],
  ]

  if (activityId) {
    void activityId
  }

  if (includeAnalytics) {
    keys.push(["analytics", "admin", tenantId])
    keys.push(["analytics", "resident", tenantId])
  }

  return keys
}

export function buildActivityFilterQueryString(
  filters?: ActivityListFilters
): string {
  const sp = new URLSearchParams()
  if (filters?.status) sp.set("status", filters.status)
  if (filters?.category) sp.set("category", filters.category)
  if (filters?.search?.trim()) sp.set("search", filters.search.trim())
  if (filters?.upcomingOnly !== undefined) {
    sp.set("upcomingOnly", filters.upcomingOnly ? "true" : "false")
  }
  if (filters?.includeDeleted !== undefined) {
    sp.set("includeDeleted", filters.includeDeleted ? "true" : "false")
  }
  if (filters?.page) sp.set("page", String(filters.page))
  if (filters?.pageSize) sp.set("pageSize", String(filters.pageSize))
  if (filters?.sortBy) sp.set("sortBy", filters.sortBy)
  if (filters?.sort) sp.set("sort", filters.sort)
  return sp.toString()
}

export function buildActivityParticipantsQueryString(
  filters?: ActivityParticipantsFilters
): string {
  const sp = new URLSearchParams()
  if (filters?.rsvpStatus) sp.set("rsvpStatus", filters.rsvpStatus)
  if (filters?.search?.trim()) sp.set("search", filters.search.trim())
  if (filters?.page) sp.set("page", String(filters.page))
  if (filters?.pageSize) sp.set("pageSize", String(filters.pageSize))
  return sp.toString()
}

