import { NextResponse, type NextRequest } from "next/server"

import { resolveAnyOperationalChatContext } from "@/lib/live-chat/queries"
import { listChatMessagesWithClient } from "@/lib/live-chat/repository"
import { chatHistoryQuerySchema } from "@/lib/live-chat/schemas"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  const auth = await resolveAnyOperationalChatContext()
  if (auth.status === "unauthenticated") {
    return NextResponse.json(
      { error: "Sesi login Anda telah berakhir." },
      { status: 401 }
    )
  }
  if (auth.status === "forbidden") {
    return NextResponse.json(
      { error: "Anda tidak memiliki akses pada ruang obrolan RT ini." },
      { status: 403 }
    )
  }

  const parsed = chatHistoryQuerySchema.safeParse({
    roomId: request.nextUrl.searchParams.get("roomId") ?? "",
    before: request.nextUrl.searchParams.get("before") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Parameter riwayat chat tidak valid." },
      { status: 400 }
    )
  }

  const requestedScope = request.nextUrl.searchParams.get("scope")
  const maskModeratedContent = !(
    requestedScope === "admin" && auth.scope === "admin"
  )

  try {
    const supabase = await createClient()
    const page = await listChatMessagesWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      roomId: parsed.data.roomId,
      before: parsed.data.before,
      limit: parsed.data.limit,
      maskModeratedContent,
    })

    return NextResponse.json(page, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Gagal memuat riwayat percakapan.",
      },
      { status: 500 }
    )
  }
}

