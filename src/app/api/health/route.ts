import { NextResponse, connection } from "next/server"

import { isSupabaseConfigured } from "@/lib/supabase/config"

/**
 * Minimal operational health check for container/orchestrator probes.
 * Intentionally avoids database queries, tenant/user data, and env/secret details.
 */
export async function GET() {
  await connection()

  const configured = isSupabaseConfigured()
  if (!configured) {
    return NextResponse.json(
      { status: "degraded", configured: false },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  }

  return NextResponse.json(
    { status: "ok", configured: true },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )
}

