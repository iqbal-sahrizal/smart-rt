import { NextResponse } from "next/server"

import { CommunityFeedServiceError } from "@/lib/community-feed/errors"
import {
  resolveAnyOperationalFeedContext,
  resolveScopedFeedContext,
  type ScopedCommunityFeedContext,
} from "@/lib/community-feed/queries"
import type { CommunityFeedScope } from "@/lib/community-feed/types"

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const

export function communityFeedJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

export async function requireScopedFeedApiContext(
  scope: CommunityFeedScope,
  forbiddenMessage: string
): Promise<
  | { ok: true; context: ScopedCommunityFeedContext }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveScopedFeedContext(scope)
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: communityFeedJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: communityFeedJson({ error: forbiddenMessage }, 403),
    }
  }
  return { ok: true, context: resolved.context }
}

export async function requireOperationalFeedApiContext(): Promise<
  | {
      ok: true
      scope: CommunityFeedScope
      context: ScopedCommunityFeedContext
    }
  | { ok: false; response: NextResponse }
> {
  const resolved = await resolveAnyOperationalFeedContext()
  if (resolved.status === "unauthenticated") {
    return {
      ok: false,
      response: communityFeedJson({ error: "Sesi login tidak ditemukan." }, 401),
    }
  }
  if (resolved.status === "forbidden") {
    return {
      ok: false,
      response: communityFeedJson(
        { error: "Akses workspace tidak valid untuk media feed komunitas." },
        403
      ),
    }
  }
  return { ok: true, scope: resolved.scope, context: resolved.context }
}

export function handleCommunityFeedRouteError(
  err: unknown,
  fallbackMessage: string
): NextResponse {
  if (err instanceof CommunityFeedServiceError) {
    return communityFeedJson({ error: err.message }, err.status)
  }
  return communityFeedJson({ error: fallbackMessage }, 500)
}

