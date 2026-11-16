import { NextResponse, type NextRequest } from "next/server"

import {
  resolveScopedRondaContext,
  type ScopedRondaContext,
} from "@/lib/ronda/queries"
import { RondaServiceError } from "@/lib/ronda/repository"
import { rondaScheduleFiltersSchema } from "@/lib/ronda/schemas"
import type { RondaScheduleFilters, RondaScope } from "@/lib/ronda/types"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const

export function parseRondaScheduleFilterParams(
  request: NextRequest
):
  | { ok: true; data: Required<Pick<RondaScheduleFilters, "page" | "pageSize" | "sort">> & Pick<RondaScheduleFilters, "fromDate" | "toDate"> }
  | { ok: false; response: NextResponse } {
  const parsed = rondaScheduleFiltersSchema.safeParse({
    fromDate: request.nextUrl.searchParams.get("fromDate") ?? undefined,
    toDate: request.nextUrl.searchParams.get("toDate") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
  })
  if (!parsed.success) {
    return {
      ok: false,
      response: rondaJson(
        { error: "Parameter filter jadwal ronda tidak valid." },
        400
      ),
    }
  }
  return { ok: true, data: parsed.data }
}

export function rondaJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

export async function requireScopedRondaApiContext(
  scope: RondaScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedRondaContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveScopedRondaContext(scope)
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: rondaJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: rondaJson({ error: forbiddenMessage }, 403),
    }
  }
  return { ok: true, context: resolved.context }
}

export function handleRondaRouteError(
  err: unknown,
  fallbackMessage: string
): NextResponse {
  if (err instanceof RondaServiceError) {
    return rondaJson({ error: err.message }, err.status)
  }
  return rondaJson({ error: fallbackMessage }, 500)
}
