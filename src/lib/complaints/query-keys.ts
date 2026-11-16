import type { QueryKey } from "@tanstack/react-query"

import type { ComplaintListFilters, ComplaintScope } from "@/lib/complaints/types"

export const complaintsQueryKeys = {
  all: (scope: ComplaintScope, tenantId: string, actorKey: string) =>
    ["complaints", scope, tenantId, actorKey] as const,
  lists: (scope: ComplaintScope, tenantId: string, actorKey: string) =>
    ["complaints", scope, tenantId, actorKey, "list"] as const,
  list: (
    scope: ComplaintScope,
    tenantId: string,
    actorKey: string,
    filters?: ComplaintListFilters
  ) =>
    [
      "complaints",
      scope,
      tenantId,
      actorKey,
      "list",
      {
        status: filters?.status ?? null,
        category: filters?.category ?? null,
        priority: filters?.priority ?? null,
        search: filters?.search?.trim() ?? "",
        page: filters?.page ?? 1,
        pageSize: filters?.pageSize ?? 10,
        sort: filters?.sort ?? "desc",
      },
    ] as const,
  details: (scope: ComplaintScope, tenantId: string, actorKey: string) =>
    ["complaints", scope, tenantId, actorKey, "detail"] as const,
  detail: (
    scope: ComplaintScope,
    tenantId: string,
    actorKey: string,
    complaintId: string
  ) => ["complaints", scope, tenantId, actorKey, "detail", complaintId] as const,
}

export function getComplaintMutationInvalidationKeys({
  tenantId,
  complaintId,
  includeDetails = true,
}: {
  tenantId: string
  complaintId?: string
  includeDetails?: boolean
}): QueryKey[] {
  const keys: QueryKey[] = [
    ["complaints", "admin", tenantId],
    ["complaints", "resident", tenantId],
  ]

  if (includeDetails && complaintId) {
    // Prefix keys already match all actorKey variants within tenant/scope
    keys.push(["complaints", "admin", tenantId])
    keys.push(["complaints", "resident", tenantId])
  }

  return keys
}

export function buildComplaintFilterQueryString(
  filters?: ComplaintListFilters
): string {
  const sp = new URLSearchParams()
  if (filters?.status) sp.set("status", filters.status)
  if (filters?.category) sp.set("category", filters.category)
  if (filters?.priority) sp.set("priority", filters.priority)
  if (filters?.search?.trim()) sp.set("search", filters.search.trim())
  if (filters?.page) sp.set("page", String(filters.page))
  if (filters?.pageSize) sp.set("pageSize", String(filters.pageSize))
  if (filters?.sort) sp.set("sort", filters.sort)
  return sp.toString()
}

