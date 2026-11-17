import { NextResponse, type NextRequest } from "next/server"

import { resolveAnyOperationalChatContext } from "@/lib/live-chat/queries"
import { chatUuidSchema } from "@/lib/live-chat/schemas"
import {
  CHAT_MEDIA_BUCKET,
  buildChatMediaPath,
  validateChatImageFile,
} from "@/lib/live-chat/storage"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
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

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      { error: "Format unggahan tidak valid." },
      { status: 400 }
    )
  }

  const parsedRoomId = chatUuidSchema.safeParse(formData.get("roomId") ?? "")
  if (!parsedRoomId.success) {
    return NextResponse.json(
      { error: "ID ruang obrolan tidak valid." },
      { status: 400 }
    )
  }

  const validated = await validateChatImageFile(formData.get("file"))
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const { tenant } = auth.context
  const supabase = await createClient()

  // Verify room belongs to active tenant
  const { data: room } = await supabase
    .from("chat_rooms")
    .select("id")
    .eq("id", parsedRoomId.data)
    .eq("tenant_id", tenant.tenantId)
    .eq("is_active", true)
    .maybeSingle()

  if (!room) {
    return NextResponse.json(
      { error: "Ruang obrolan RT tidak ditemukan." },
      { status: 404 }
    )
  }

  const storagePath = buildChatMediaPath(
    tenant.tenantId,
    parsedRoomId.data,
    tenant.memberId,
    validated.file.extension
  )

  const { error: uploadErr } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(storagePath, validated.file.buffer, {
      contentType: validated.file.mimeType,
      upsert: false,
    })

  if (uploadErr) {
    return NextResponse.json(
      { error: uploadErr.message || "Gagal mengunggah foto ke penyimpanan." },
      { status: 500 }
    )
  }

  const { data: signed } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 3600)

  return NextResponse.json(
    {
      path: storagePath,
      mimeType: validated.file.mimeType,
      size: validated.file.size,
      signedUrl: signed?.signedUrl ?? null,
    },
    { status: 201 }
  )
}

