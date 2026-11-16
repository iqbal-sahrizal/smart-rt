import { NextResponse, connection } from "next/server"

import {
  lettersJson,
  requireOperationalLetterApiContext,
} from "@/lib/letters/http"
import {
  extractLetterAttachmentFileId,
  inferLetterAttachmentContentType,
  LETTER_REQUEST_DOCS_BUCKET,
  letterAttachmentPathBelongsTo,
} from "@/lib/letters/storage"
import { canViewLetterDocuments } from "@/lib/letters/types"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  await connection()

  const { id: requestId, fileId } = await context.params
  if (!isValidUuid(requestId) || !isValidUuid(fileId)) {
    return lettersJson(
      { error: "ID permohonan atau ID lampiran tidak valid." },
      400
    )
  }

  const auth = await requireOperationalLetterApiContext()
  if (!auth.ok) return auth.response

  const { tenant } = auth.context

  if (auth.scope === "admin" && !canViewLetterDocuments(tenant.roles)) {
    return lettersJson(
      {
        error:
          "Role Anda hanya memiliki akses metadata dan tidak berhak melihat dokumen lampiran.",
      },
      403
    )
  }

  const supabase = await createClient()
  const { data: rowData, error: fetchErr } = await supabase
    .from("letter_requests")
    .select(
      "id, tenant_id, resident_id, requested_by_member_id, supporting_doc_paths"
    )
    .eq("id", requestId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  if (fetchErr || !rowData) {
    return lettersJson(
      { error: "Permohonan surat tidak ditemukan atau tidak memiliki akses." },
      404
    )
  }

  const row = rowData as {
    id: string
    tenant_id: string
    resident_id: string
    requested_by_member_id: string
    supporting_doc_paths: unknown
  }

  if (auth.scope === "resident") {
    const isOwner =
      row.requested_by_member_id === tenant.memberId ||
      (tenant.residentId !== null && row.resident_id === tenant.residentId)
    if (!isOwner) {
      return lettersJson(
        { error: "Permohonan surat tidak ditemukan atau tidak memiliki akses." },
        404
      )
    }
  }

  const storedPaths = Array.isArray(row.supporting_doc_paths)
    ? row.supporting_doc_paths.filter((p): p is string => typeof p === "string")
    : []

  const normalizedFileId = fileId.toLowerCase()
  const matchedPath = storedPaths.find(
    (p) =>
      letterAttachmentPathBelongsTo(p, tenant.tenantId, row.id) &&
      extractLetterAttachmentFileId(p) === normalizedFileId
  )

  if (!matchedPath) {
    return lettersJson({ error: "Dokumen lampiran tidak ditemukan." }, 404)
  }

  const [pendingRes, retiredRes] = await Promise.all([
    supabase.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: LETTER_REQUEST_DOCS_BUCKET,
      p_object_path: matchedPath,
    }),
    supabase.rpc("is_storage_object_path_retired", {
      p_bucket_id: LETTER_REQUEST_DOCS_BUCKET,
      p_object_path: matchedPath,
    }),
  ])

  if (
    pendingRes.error ||
    retiredRes.error ||
    pendingRes.data === true ||
    retiredRes.data === true
  ) {
    return lettersJson({ error: "Dokumen lampiran tidak tersedia." }, 404)
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(LETTER_REQUEST_DOCS_BUCKET)
    .download(matchedPath)

  if (downloadErr || !blob) {
    return lettersJson(
      { error: "Gagal mengambil berkas dokumen lampiran." },
      404
    )
  }

  const { contentType, extension } =
    inferLetterAttachmentContentType(matchedPath)
  const fileBuffer = await blob.arrayBuffer()

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="lampiran-surat-${row.id.slice(0, 8)}-${normalizedFileId.slice(0, 8)}.${extension}"`,
      "Content-Length": String(fileBuffer.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

