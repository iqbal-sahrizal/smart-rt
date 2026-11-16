import { NextResponse, type NextRequest } from "next/server"

import { LetterServiceError } from "@/lib/letters/errors"
import {
  resolveAnyOperationalLetterContext,
  resolveScopedLetterContext,
  type ScopedLetterContext,
} from "@/lib/letters/queries"
import { letterListFiltersSchema } from "@/lib/letters/schemas"
import type {
  LetterListFilters,
  LetterScope,
} from "@/lib/letters/types"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const

export function lettersJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

export function parseLetterFilterParams(
  request: NextRequest
):
  | {
      ok: true
      data: Required<
        Pick<LetterListFilters, "page" | "pageSize" | "sortBy" | "sort">
      > &
        Omit<LetterListFilters, "page" | "pageSize" | "sortBy" | "sort">
    }
  | { ok: false; response: NextResponse } {
  const parsed = letterListFiltersSchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    letterTypeId: request.nextUrl.searchParams.get("letterTypeId") ?? undefined,
    search: request.nextUrl.searchParams.get("search") ?? undefined,
    page: request.nextUrl.searchParams.get("page") ?? undefined,
    pageSize: request.nextUrl.searchParams.get("pageSize") ?? undefined,
    sortBy: request.nextUrl.searchParams.get("sortBy") ?? undefined,
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
  })

  if (!parsed.success) {
    return {
      ok: false,
      response: lettersJson(
        { error: "Parameter filter permohonan surat tidak valid." },
        400
      ),
    }
  }

  return { ok: true, data: parsed.data }
}

export async function requireScopedLetterApiContext(
  scope: LetterScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedLetterContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveScopedLetterContext(scope)
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: lettersJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: lettersJson({ error: forbiddenMessage }, 403),
    }
  }
  return { ok: true, context: resolved.context }
}

export async function requireOperationalLetterApiContext(): Promise<
  | { ok: true; scope: LetterScope; context: ScopedLetterContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveAnyOperationalLetterContext()
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: lettersJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: lettersJson(
        { error: "Akses workspace tidak valid untuk dokumen surat." },
        403
      ),
    }
  }
  return { ok: true, scope: resolved.scope, context: resolved.context }
}

export function handleLetterRouteError(
  err: unknown,
  fallbackMessage: string
): NextResponse {
  if (err instanceof LetterServiceError) {
    return lettersJson({ error: err.message }, err.status)
  }
  return lettersJson({ error: fallbackMessage }, 500)
}

