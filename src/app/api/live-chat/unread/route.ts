import { NextResponse } from "next/server"

import { resolveAnyOperationalChatContext } from "@/lib/live-chat/queries"
import { getChatUnreadCountWithClient } from "@/lib/live-chat/repository"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const auth = await resolveAnyOperationalChatContext()
  if (auth.status === "unauthenticated") {
    return NextResponse.json(
      { error: "Sesi login Anda telah berakhir." },
      { status: 401 }
    )
  }
  if (auth.status === "forbidden") {
    return NextResponse.json(
      { error: "Tidak memiliki akses obrolan RT." },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const unread = await getChatUnreadCountWithClient(
    supabase,
    auth.context.tenant.tenantId
  )

  return NextResponse.json(unread, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  })
}

