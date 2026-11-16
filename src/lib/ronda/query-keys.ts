import type { QueryKey } from "@tanstack/react-query"

import type {
  RondaAttendanceFilterParams,
  RondaScheduleFilters,
  RondaScope,
} from "@/lib/ronda/types"

export const rondaQueryKeys = {
  all: (scope: RondaScope, tenantId: string) =>
    ["ronda", scope, tenantId] as const,
  lists: (scope: RondaScope, tenantId: string) =>
    ["ronda", scope, tenantId, "list"] as const,
  list: (
    scope: RondaScope,
    tenantId: string,
    filters?: RondaScheduleFilters
  ) =>
    [
      "ronda",
      scope,
      tenantId,
      "list",
      {
        fromDate: filters?.fromDate ?? null,
        toDate: filters?.toDate ?? null,
        page: filters?.page ?? 1,
        pageSize: filters?.pageSize ?? 20,
        sort: filters?.sort ?? "desc",
      },
    ] as const,
  details: (scope: RondaScope, tenantId: string) =>
    ["ronda", scope, tenantId, "detail"] as const,
  detail: (scope: RondaScope, tenantId: string, scheduleId: string) =>
    ["ronda", scope, tenantId, "detail", scheduleId] as const,
  candidatesAll: (tenantId: string) =>
    ["ronda", "admin", tenantId, "candidates"] as const,
  candidates: (tenantId: string, search?: string) =>
    ["ronda", "admin", tenantId, "candidates", search?.trim() ?? ""] as const,
  adminAttendanceAll: (tenantId: string) =>
    ["ronda", "admin", tenantId, "attendance"] as const,
  adminAttendance: (
    tenantId: string,
    params?: RondaAttendanceFilterParams
  ) =>
    [
      "ronda",
      "admin",
      tenantId,
      "attendance",
      {
        scheduleId: params?.scheduleId ?? null,
        fromDate: params?.fromDate ?? null,
        toDate: params?.toDate ?? null,
      },
    ] as const,
  myAttendanceAll: (tenantId: string) =>
    ["ronda", "resident", tenantId, "my-attendance"] as const,
  myAttendance: (tenantId: string, scheduleId?: string) =>
    [
      "ronda",
      "resident",
      tenantId,
      "my-attendance",
      scheduleId ?? "all",
    ] as const,
}

export function getRondaMutationInvalidationKeys({
  tenantId,
  scheduleId,
  kind,
}: {
  tenantId: string
  scheduleId?: string
  kind: "upsert" | "delete" | "attendance"
}): QueryKey[] {
  const keys: QueryKey[] = [
    rondaQueryKeys.lists("admin", tenantId),
    rondaQueryKeys.lists("resident", tenantId),
    rondaQueryKeys.adminAttendanceAll(tenantId),
    rondaQueryKeys.myAttendanceAll(tenantId),
  ]

  if (scheduleId) {
    keys.push(rondaQueryKeys.detail("admin", tenantId, scheduleId))
    keys.push(rondaQueryKeys.detail("resident", tenantId, scheduleId))
  } else if (kind !== "attendance") {
    keys.push(rondaQueryKeys.details("admin", tenantId))
    keys.push(rondaQueryKeys.details("resident", tenantId))
  }

  return keys
}

export function buildRondaFilterQueryString(
  filters?: RondaScheduleFilters
): string {
  const sp = new URLSearchParams()
  if (filters?.fromDate) sp.set("fromDate", filters.fromDate)
  if (filters?.toDate) sp.set("toDate", filters.toDate)
  if (filters?.page) sp.set("page", String(filters.page))
  if (filters?.pageSize) sp.set("pageSize", String(filters.pageSize))
  if (filters?.sort) sp.set("sort", filters.sort)
  return sp.toString()
}

