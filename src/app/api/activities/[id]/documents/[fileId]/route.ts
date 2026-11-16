import { NextResponse, connection } from "next/server"

import {
  activitiesJson,
  requireOperationalActivityApiContext,
} from "@/lib/activities/http"
import {
  ACTIVITY_DOCS_BUCKET,
  activityDocPathBelongsTo,
  extractActivityDocFileId,
  inferActivityDocContentType,
} from "@/lib/activities/storage"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  await connection()

  const { id: activityId, fileId } = await context.params
  if (!isValidUuid(activityId) || !isValidUuid(fileId)) {
    return activitiesJson(
      { error: "ID kegiatan atau ID berkas dokumentasi tidak valid." },
      400
    )
  }

  const auth = await requireOperationalActivityApiContext()
  if (!auth.ok) return auth.response

  const { tenant } = auth.context
  const supabase = await createClient()

  const { data: rowData, error: fetchErr } = await supabase
    .from("activities")
    .select("id, tenant_id, status, documentation_paths, deleted_at")
    .eq("id", activityId)
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr || !rowData) {
    return activitiesJson(
      { error: "Kegiatan warga tidak ditemukan atau tidak memiliki akses." },
      404
    )
  }

  const row = rowData as {
    id: string
    tenant_id: string
    status: string
    documentation_paths: unknown
    deleted_at: string | null
  }

  const paths = Array.isArray(row.documentation_paths)
    ? row.documentation_paths.filter((p): p is string => typeof p === "string")
    : []

  const normalizedFileId = fileId.toLowerCase()
  const matchedPath = paths.find(
    (p) =>
      activityDocPathBelongsTo(p, tenant.tenantId, row.id) &&
      extractActivityDocFileId(p) === normalizedFileId
  )

  if (!matchedPath) {
    return activitiesJson(
      { error: "Berkas dokumentasi kegiatan tidak ditemukan." },
      404
    )
  }

  const [pendingRes, retiredRes] = await Promise.all([
    supabase.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: ACTIVITY_DOCS_BUCKET,
      p_object_path: matchedPath,
    }),
    supabase.rpc("is_storage_object_path_retired", {
      p_bucket_id: ACTIVITY_DOCS_BUCKET,
      p_object_path: matchedPath,
    }),
  ])

  if (
    pendingRes.error ||
    retiredRes.error ||
    pendingRes.data === true ||
    retiredRes.data === true
  ) {
    return activitiesJson(
      { error: "Berkas dokumentasi kegiatan tidak tersedia." },
      404
    )
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(ACTIVITY_DOCS_BUCKET)
    .download(matchedPath)

  if (downloadErr || !blob) {
    return activitiesJson(
      { error: "Gagal mengambil berkas dokumentasi kegiatan." },
      404
    )
  }

  const { contentType, extension } = inferActivityDocContentType(matchedPath)
  const url = new URL(request.url)
  const forceDownload = url.searchParams.get("download") === "1"
  const dispositionType = forceDownload ? "attachment" : "inline"
  const fileBuffer = await blob.arrayBuffer()

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${dispositionType}; filename="dokumentasi-kegiatan-${row.id.slice(0, 8)}-${normalizedFileId.slice(0, 8)}.${extension}"`,
      "Content-Length": String(fileBuffer.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

