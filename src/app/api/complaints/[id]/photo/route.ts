import { NextResponse, connection } from "next/server"

import {
  complaintsJson,
  requireOperationalComplaintApiContext,
} from "@/lib/complaints/http"
import {
  COMPLAINT_PHOTO_BUCKET,
  complaintPhotoPathBelongsTo,
  inferComplaintPhotoContentType,
  isValidComplaintPhotoPath,
} from "@/lib/complaints/storage"
import { canViewComplaintPhotos } from "@/lib/complaints/types"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await connection()

  const { id: complaintId } = await context.params
  if (!isValidUuid(complaintId)) {
    return complaintsJson({ error: "ID pengaduan tidak valid." }, 400)
  }

  const auth = await requireOperationalComplaintApiContext()
  if (!auth.ok) return auth.response

  const { tenant } = auth.context

  if (auth.scope === "admin" && !canViewComplaintPhotos(tenant.roles)) {
    return complaintsJson(
      {
        error:
          "Role Anda hanya memiliki akses metadata dan tidak berhak melihat foto pengaduan.",
      },
      403
    )
  }

  const supabase = await createClient()
  const { data: rowData, error: fetchErr } = await supabase
    .from("complaints")
    .select("id, tenant_id, reporter_member_id, photo_path, deleted_at")
    .eq("id", complaintId)
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)
    .maybeSingle()

  if (fetchErr || !rowData) {
    return complaintsJson(
      { error: "Pengaduan tidak ditemukan atau tidak memiliki akses." },
      404
    )
  }

  const row = rowData as {
    id: string
    tenant_id: string
    reporter_member_id: string
    photo_path: string | null
    deleted_at: string | null
  }

  if (
    auth.scope === "resident" &&
    row.reporter_member_id !== tenant.memberId
  ) {
    return complaintsJson(
      { error: "Anda tidak memiliki izin untuk melihat foto pengaduan ini." },
      403
    )
  }

  if (
    !row.photo_path ||
    !isValidComplaintPhotoPath(row.photo_path) ||
    !complaintPhotoPathBelongsTo(row.photo_path, tenant.tenantId, row.id)
  ) {
    return complaintsJson({ error: "Foto pengaduan belum tersedia." }, 404)
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(COMPLAINT_PHOTO_BUCKET)
    .download(row.photo_path)

  if (downloadErr || !blob) {
    return complaintsJson(
      { error: "Gagal mengambil berkas foto pengaduan." },
      404
    )
  }

  const { contentType, extension } = inferComplaintPhotoContentType(
    row.photo_path
  )
  const url = new URL(request.url)
  const forceDownload = url.searchParams.get("download") === "1"
  const dispositionType = forceDownload ? "attachment" : "inline"
  const fileBuffer = await blob.arrayBuffer()

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${dispositionType}; filename="foto-pengaduan-${row.id.slice(0, 8)}.${extension}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

