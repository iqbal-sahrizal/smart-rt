import { NextResponse, type NextRequest } from "next/server"

import {
  buildAdminAnalyticsCsv,
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
      { error: "Anda tidak memiliki izin mengekspor laporan RT." },
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
  const period = parsed.value.filter

  try {
    const csvContent = await buildAdminAnalyticsCsv({
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      tenantSubtitle: `RT ${tenant.rtNumber} / RW ${tenant.rwNumber}`,
      period,
    })

    const safeCode = tenant.tenantCode.replace(/[^a-zA-Z0-9_-]/g, "") || "rt"
    const filename = `laporan-${safeCode}-${period.startDate}-${period.endDate}.csv`

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[analytics/export] Failed to generate CSV:", err)
    return NextResponse.json(
      { error: "Gagal membuat file ekspor CSV laporan." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}

