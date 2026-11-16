import type { QueryKey } from "@tanstack/react-query"

import type { LetterListFilters, LetterScope } from "@/lib/letters/types"

export const lettersQueryKeys = {
  all: (scope: LetterScope, tenantId: string, actorKey: string) =>
    ["letters", scope, tenantId, actorKey] as const,
  lists: (scope: LetterScope, tenantId: string, actorKey: string) =>
    ["letters", scope, tenantId, actorKey, "list"] as const,
  list: (
    scope: LetterScope,
    tenantId: string,
    actorKey: string,
    filters?: LetterListFilters
  ) =>
    [
      "letters",
      scope,
      tenantId,
      actorKey,
      "list",
      {
        status: filters?.status ?? null,
        letterTypeId: filters?.letterTypeId ?? null,
        search: filters?.search?.trim() ?? "",
        page: filters?.page ?? 1,
        pageSize: filters?.pageSize ?? 10,
        sortBy: filters?.sortBy ?? "created_at",
        sort: filters?.sort ?? "desc",
      },
    ] as const,
  details: (scope: LetterScope, tenantId: string, actorKey: string) =>
    ["letters", scope, tenantId, actorKey, "detail"] as const,
  detail: (
    scope: LetterScope,
    tenantId: string,
    actorKey: string,
    requestId: string
  ) => ["letters", scope, tenantId, actorKey, "detail", requestId] as const,
  types: (scope: LetterScope, tenantId: string, actorKey: string) =>
    ["letters", scope, tenantId, actorKey, "types"] as const,
}

export function getLetterMutationInvalidationKeys({
  tenantId,
  requestId,
  includeTypes = false,
  includeAnalytics = true,
}: {
  tenantId: string
  requestId?: string
  includeTypes?: boolean
  includeAnalytics?: boolean
}): QueryKey[] {
  const keys: QueryKey[] = [
    ["letters", "admin", tenantId],
    ["letters", "resident", tenantId],
  ]

  if (requestId) {
    // Prefix keys above cover all actorKey variants within tenant/scope,
    // keeping explicit reference for clarity.
    void requestId
  }

  if (includeTypes) {
    keys.push(["letters", "admin", tenantId])
    keys.push(["letters", "resident", tenantId])
  }

  if (includeAnalytics) {
    keys.push(["analytics", "admin", tenantId])
    keys.push(["analytics", "resident", tenantId])
  }

  return keys
}

export function buildLetterFilterQueryString(
  filters?: LetterListFilters
): string {
  const sp = new URLSearchParams()
  if (filters?.status) sp.set("status", filters.status)
  if (filters?.letterTypeId) sp.set("letterTypeId", filters.letterTypeId)
  if (filters?.search?.trim()) sp.set("search", filters.search.trim())
  if (filters?.page) sp.set("page", String(filters.page))
  if (filters?.pageSize) sp.set("pageSize", String(filters.pageSize))
  if (filters?.sortBy) sp.set("sortBy", filters.sortBy)
  if (filters?.sort) sp.set("sort", filters.sort)
  return sp.toString()
}

