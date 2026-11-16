import { NextResponse, type NextRequest } from "next/server"

import {
  getAdminDashboardAnalytics,
  resolveScopedAdminAnalyticsContext,
} from "@/lib/analytics/queries"
import { parseAnalyticsSearchParams } from "@/lib/analytics/schemas"

export async function GET(request: NextRequest) {
  const resolved = await resolveScopedAdminAnalyticsContext()
  if (resolved.status === "unauthenticated") {
    return NextResponse.json(
      { error: "Sesi login tidak ditemukan." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    )
  }
  if (resolved.status === "forbidden") {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses laporan dashboard pengurus." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    )
  }

  const rawParams: Record<string, string | undefined> = {}
  request.nextUrl.searchParams.forEach((value, key) => {
    rawParams[key] = value
  })

  const parsed = parseAnalyticsSearchParams(rawParams)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    )
  }

  const { tenant } = resolved.context
  const { filter, activityCategory, activityPage, activityPageSize } =
    parsed.value

  const data = await getAdminDashboardAnalytics({
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    tenantSubtitle: `RT ${tenant.rtNumber} / RW ${tenant.rwNumber}`,
    filter,
    activityCategory,
    activityPage,
    activityPageSize,
  })

  if (data.error) {
    return NextResponse.json(
      { error: data.error },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }

  return NextResponse.json(data, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  })
}

