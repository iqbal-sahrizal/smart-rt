import { NextResponse, type NextRequest } from "next/server"

import {
  getNotificationSummaryForTenant,
  getNotificationsPageForTenant,
  resolveScopedNotificationContext,
} from "@/lib/notifications/queries"
import { notificationsApiQuerySchema } from "@/lib/notifications/schemas"

export async function GET(request: NextRequest) {
  const rawParams = {
    scope: request.nextUrl.searchParams.get("scope") ?? undefined,
    mode: request.nextUrl.searchParams.get("mode") ?? undefined,
    filter: request.nextUrl.searchParams.get("filter") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    cursorCreatedAt:
      request.nextUrl.searchParams.get("cursorCreatedAt") ?? undefined,
    cursorId: request.nextUrl.searchParams.get("cursorId") ?? undefined,
  }

  const parsed = notificationsApiQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parameter permintaan notifikasi tidak valid." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }

  const { scope, mode, filter, limit, cursorCreatedAt, cursorId } = parsed.data

  if ((cursorCreatedAt && !cursorId) || (!cursorCreatedAt && cursorId)) {
    return NextResponse.json(
      { error: "Cursor paginasi harus menyertakan waktu dan ID." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }

  const resolved = await resolveScopedNotificationContext(scope)
  if (resolved.status === "unauthenticated") {
    return NextResponse.json(
      { error: "Sesi login tidak ditemukan." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    )
  }

  if (resolved.status === "forbidden") {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses notifikasi pada workspace ini." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    )
  }

  const { ctx, tenant } = resolved.context

  try {
    if (mode === "summary") {
      const summary = await getNotificationSummaryForTenant({
        tenantId: tenant.tenantId,
        userId: ctx.user.id,
        scope,
        limit: Math.min(limit, 8),
      })
      return NextResponse.json(summary, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      })
    }

    const page = await getNotificationsPageForTenant({
      tenantId: tenant.tenantId,
      userId: ctx.user.id,
      scope,
      filter,
      limit,
      cursorCreatedAt,
      cursorId,
    })

    return NextResponse.json(page, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    console.error("[notifications/route] Failed to load notifications:", err)
    return NextResponse.json(
      { error: "Gagal memuat notifikasi. Silakan coba lagi." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}

