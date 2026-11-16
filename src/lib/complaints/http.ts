import { NextResponse, type NextRequest } from "next/server"

import {
  resolveAnyOperationalComplaintContext,
  resolveScopedComplaintContext,
  type ScopedComplaintContext,
} from "@/lib/complaints/queries"
import { ComplaintServiceError } from "@/lib/complaints/repository"
import { complaintListFiltersSchema } from "@/lib/complaints/schemas"
import type { ComplaintListFilters, ComplaintScope } from "@/lib/complaints/types"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const

export function complaintsJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

export function parseComplaintFilterParams(
  request: NextRequest
):
  | {
      ok: true
      data: Required<Pick<ComplaintListFilters, "page" | "pageSize" | "sort">> &
        Omit<ComplaintListFilters, "page" | "pageSize" | "sort">
    }
  | { ok: false; response: NextResponse } {
  const parsed = complaintListFiltersSchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    category: request.nextUrl.searchParams.get("category") ?? undefined,
    priority: request.nextUrl.searchParams.get("priority") ?? undefined,
    search: request.nextUrl.searchParams.get("search") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
  })

  if (!parsed.success) {
    return {
      ok: false,
      response: complaintsJson(
        { error: "Parameter filter pengaduan tidak valid." },
        400
      ),
    }
  }

  return { ok: true, data: parsed.data }
}

export async function requireScopedComplaintApiContext(
  scope: ComplaintScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedComplaintContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveScopedComplaintContext(scope)
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: complaintsJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: complaintsJson({ error: forbiddenMessage }, 403),
    }
  }
  return { ok: true, context: resolved.context }
}

export async function requireOperationalComplaintApiContext(): Promise<
  | { ok: true; scope: ComplaintScope; context: ScopedComplaintContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveAnyOperationalComplaintContext()
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: complaintsJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: complaintsJson(
        { error: "Akses workspace tidak valid untuk pengaduan." },
        403
      ),
    }
  }
  return { ok: true, scope: resolved.scope, context: resolved.context }
}

export function handleComplaintRouteError(
  err: unknown,
  fallbackMessage: string
): NextResponse {
  if (err instanceof ComplaintServiceError) {
    return complaintsJson({ error: err.message }, err.status)
  }
  return complaintsJson({ error: fallbackMessage }, 500)
}

