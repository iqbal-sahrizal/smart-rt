import { NextRequest, connection } from "next/server"

import {
  communityFeedJson,
  handleCommunityFeedRouteError,
  requireScopedFeedApiContext,
} from "@/lib/community-feed/http"
import {
  cleanupOrphanCommunityMediaWithClient,
  uploadCommunityMediaFileWithClient,
} from "@/lib/community-feed/repository"
import { cleanupMediaPathsSchema } from "@/lib/community-feed/schemas"
import { validateCommunityImageFile } from "@/lib/community-feed/storage"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  await connection()

  const auth = await requireScopedFeedApiContext(
    "resident",
    "Hanya warga aktif yang dapat mengunggah foto ke feed komunitas."
  )
  if (!auth.ok) return auth.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return communityFeedJson({ error: "Format unggahan berkas tidak valid." }, 400)
  }

  const fileEntry = formData.get("file")
  const validated = await validateCommunityImageFile(fileEntry)
  if (!validated.ok) {
    return communityFeedJson({ error: validated.error }, 400)
  }

  try {
    const supabase = await createClient()
    const uploaded = await uploadCommunityMediaFileWithClient(supabase, {
      tenantId: auth.context.tenant.tenantId,
      memberId: auth.context.tenant.memberId,
      validatedFile: validated.file,
    })
    return communityFeedJson(uploaded, 201)
  } catch (err) {
    return handleCommunityFeedRouteError(
      err,
      "Gagal mengunggah gambar ke penyimpanan privat."
    )
  }
}

export async function DELETE(request: NextRequest) {
  await connection()

  const auth = await requireScopedFeedApiContext(
    "resident",
    "Hanya warga aktif yang dapat membersihkan berkas unggahan sementara."
  )
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return communityFeedJson({ error: "Payload tidak valid." }, 400)
  }

  const parsed = cleanupMediaPathsSchema.safeParse(body)
  if (!parsed.success) {
    return communityFeedJson({ error: "Daftar path tidak valid." }, 400)
  }

  try {
    const supabase = await createClient()
    const removedCount = await cleanupOrphanCommunityMediaWithClient(
      supabase,
      {
        tenantId: auth.context.tenant.tenantId,
        memberId: auth.context.tenant.memberId,
        paths: parsed.data.paths,
      }
    )
    return communityFeedJson({ ok: true, removedCount }, 200)
  } catch (err) {
    return handleCommunityFeedRouteError(
      err,
      "Gagal membersihkan berkas media sementara."
    )
  }
}

