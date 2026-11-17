import { NextResponse, type NextRequest } from "next/server"

import { resolveAnyOperationalChatContext } from "@/lib/live-chat/queries"
import { chatUuidSchema } from "@/lib/live-chat/schemas"
import {
  CHAT_MEDIA_BUCKET,
  chatMediaPathBelongsToScope,
} from "@/lib/live-chat/storage"
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

  const parsedRoom = chatUuidSchema.safeParse(
    request.nextUrl.searchParams.get("roomId") ?? ""
  )
  const storagePath = (request.nextUrl.searchParams.get("path") ?? "").trim()
  if (!parsedRoom.success || !storagePath) {
    return NextResponse.json(
      { error: "Parameter media chat tidak valid." },
      { status: 400 }
    )
  }

  const { tenant } = auth.context
  if (!chatMediaPathBelongsToScope(storagePath, tenant.tenantId, parsedRoom.data)) {
    return NextResponse.json(
      { error: "Akses media ditolak (lintas tenant atau room)." },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 3600)

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: "Foto tidak tersedia atau akses dibatasi." },
      { status: 404 }
    )
  }

  return NextResponse.json(
    { signedUrl: data.signedUrl },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  )
}

