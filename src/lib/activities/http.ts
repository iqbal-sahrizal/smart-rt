import { NextResponse, type NextRequest } from "next/server"

import { ActivityServiceError } from "@/lib/activities/errors"
import {
  resolveAnyOperationalActivityContext,
  resolveScopedActivityContext,
  type ScopedActivityContext,
} from "@/lib/activities/queries"
import {
  activityListFiltersSchema,
  activityParticipantsFiltersSchema,
} from "@/lib/activities/schemas"
import type {
  ActivityListFilters,
  ActivityParticipantsFilters,
  ActivityScope,
} from "@/lib/activities/types"

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const

export function activitiesJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

export function parseActivityFilterParams(request: NextRequest):
  | {
      ok: true
      data: Required<
        Pick<ActivityListFilters, "page" | "pageSize" | "sortBy" | "sort">
      > &
        Omit<ActivityListFilters, "page" | "pageSize" | "sortBy" | "sort">
    }
  | { ok: false; response: NextResponse } {
  const parsed = activityListFiltersSchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    category: request.nextUrl.searchParams.get("category") ?? undefined,
    search: request.nextUrl.searchParams.get("search") ?? undefined,
    upcomingOnly: request.nextUrl.searchParams.get("upcomingOnly") ?? undefined,
    includeDeleted:
      request.nextUrl.searchParams.get("includeDeleted") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
    sortBy: request.nextUrl.searchParams.get("sortBy") ?? undefined,
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
  })

  if (!parsed.success) {
    return {
      ok: false,
      response: activitiesJson(
        { error: "Parameter filter kegiatan warga tidak valid." },
        400
      ),
    }
  }

  return { ok: true, data: parsed.data }
}

export function parseActivityParticipantsFilterParams(request: NextRequest):
  | {
      ok: true
      data: Required<Pick<ActivityParticipantsFilters, "page" | "pageSize">> &
        Omit<ActivityParticipantsFilters, "page" | "pageSize">
    }
  | { ok: false; response: NextResponse } {
  const parsed = activityParticipantsFiltersSchema.safeParse({
    rsvpStatus: request.nextUrl.searchParams.get("rsvpStatus") ?? undefined,
    search: request.nextUrl.searchParams.get("search") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
  })

  if (!parsed.success) {
    return {
      ok: false,
      response: activitiesJson(
        { error: "Parameter filter peserta kegiatan tidak valid." },
        400
      ),
    }
  }

  return { ok: true, data: parsed.data }
}

export async function requireScopedActivityApiContext(
  scope: ActivityScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedActivityContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveScopedActivityContext(scope)
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: activitiesJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: activitiesJson({ error: forbiddenMessage }, 403),
    }
  }
  return { ok: true, context: resolved.context }
}

export async function requireOperationalActivityApiContext(): Promise<
  | { ok: true; scope: ActivityScope; context: ScopedActivityContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveAnyOperationalActivityContext()
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: activitiesJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: activitiesJson(
        { error: "Akses workspace tidak valid untuk dokumentasi kegiatan." },
        403
      ),
    }
  }
  return { ok: true, scope: resolved.scope, context: resolved.context }
}

export function handleActivityRouteError(
  err: unknown,
  fallbackMessage: string
): NextResponse {
  if (err instanceof ActivityServiceError) {
    return activitiesJson({ error: err.message }, err.status)
  }
  return activitiesJson({ error: fallbackMessage }, 500)
}

