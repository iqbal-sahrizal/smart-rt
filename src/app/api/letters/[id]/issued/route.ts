import { NextResponse, connection } from "next/server"

import {
  lettersJson,
  requireOperationalLetterApiContext,
} from "@/lib/letters/http"
import {
  ISSUED_LETTERS_BUCKET,
  issuedLetterPdfPathBelongsTo,
  isValidIssuedLetterPdfPath,
} from "@/lib/letters/storage"
import {
  canViewLetterDocuments,
  type LetterRequestStatus,
} from "@/lib/letters/types"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await connection()

  const { id: requestId } = await context.params
  if (!isValidUuid(requestId)) {
    return lettersJson({ error: "ID permohonan surat tidak valid." }, 400)
  }

  const auth = await requireOperationalLetterApiContext()
  if (!auth.ok) return auth.response

  const { tenant } = auth.context

  if (auth.scope === "admin" && !canViewLetterDocuments(tenant.roles)) {
    return lettersJson(
      {
        error:
          "Role Anda hanya memiliki akses metadata dan tidak berhak mengunduh dokumen surat.",
      },
      403
    )
  }

  const supabase = await createClient()
  const { data: rowData, error: fetchErr } = await supabase
    .from("letter_requests")
    .select(
      "id, tenant_id, resident_id, requested_by_member_id, status, issued_file_path"
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
    status: LetterRequestStatus
    issued_file_path: string | null
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

  if (
    row.status !== "completed" ||
    !row.issued_file_path ||
    !isValidIssuedLetterPdfPath(row.issued_file_path) ||
    !issuedLetterPdfPathBelongsTo(
      row.issued_file_path,
      tenant.tenantId,
      row.id
    )
  ) {
    return lettersJson({ error: "Dokumen PDF surat belum tersedia." }, 404)
  }

  const [pendingRes, retiredRes] = await Promise.all([
    supabase.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: ISSUED_LETTERS_BUCKET,
      p_object_path: row.issued_file_path,
    }),
    supabase.rpc("is_storage_object_path_retired", {
      p_bucket_id: ISSUED_LETTERS_BUCKET,
      p_object_path: row.issued_file_path,
    }),
  ])

  if (
    pendingRes.error ||
    retiredRes.error ||
    pendingRes.data === true ||
    retiredRes.data === true
  ) {
    return lettersJson({ error: "Dokumen PDF surat tidak tersedia." }, 404)
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(ISSUED_LETTERS_BUCKET)
    .download(row.issued_file_path)

  if (downloadErr || !blob) {
    return lettersJson(
      { error: "Gagal mengambil dokumen PDF surat terbit." },
      404
    )
  }

  const url = new URL(request.url)
  const forceDownload = url.searchParams.get("download") === "1"
  const dispositionType = forceDownload ? "attachment" : "inline"
  const fileBuffer = await blob.arrayBuffer()

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${dispositionType}; filename="surat-terbit-${row.id.slice(0, 8)}.pdf"`,
      "Content-Length": String(fileBuffer.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

