import { NextResponse, connection } from "next/server"

import { getAuthContext } from "@/lib/auth/server"
import { checkResidentOwnsBill } from "@/lib/finance/ownership"
import {
  inferContentTypeFromStoragePath,
  isValidPaymentProofPath,
  PAYMENT_PROOFS_BUCKET,
  paymentProofPathBelongsTo,
} from "@/lib/finance/storage"
import { canManageBills } from "@/lib/finance/types"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await connection()

  const { id: paymentId } = await context.params
  if (!isValidUuid(paymentId)) {
    return NextResponse.json(
      { error: "ID pembayaran tidak valid." },
      { status: 400 }
    )
  }

  const ctx = await getAuthContext()
  if (!ctx) {
    return NextResponse.json(
      { error: "Autentikasi diperlukan." },
      { status: 401 }
    )
  }

  const workspace = ctx.selectedWorkspace
  const tenant = ctx.resolvedTenant
  if (!workspace || !tenant || workspace.type === "super_admin") {
    return NextResponse.json(
      { error: "Akses workspace tidak valid untuk bukti pembayaran." },
      { status: 403 }
    )
  }

  if (workspace.type === "admin" && !canManageBills(tenant.roles)) {
    return NextResponse.json(
      {
        error:
          "Hanya Bendahara yang berhak melihat bukti pembayaran di workspace pengurus.",
      },
      { status: 403 }
    )
  }

  const supabase = await createClient()
  const { data: paymentRow, error: paymentErr } = await supabase
    .from("payments")
    .select("id, tenant_id, bill_id, paid_by_user_id, proof_storage_path")
    .eq("id", paymentId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  if (paymentErr || !paymentRow) {
    return NextResponse.json(
      { error: "Pembayaran tidak ditemukan atau tidak memiliki akses." },
      { status: 404 }
    )
  }

  const payment = paymentRow as {
    id: string
    tenant_id: string
    bill_id: string
    paid_by_user_id: string
    proof_storage_path: string | null
  }

  if (workspace.type === "resident") {
    let isOwner = payment.paid_by_user_id === ctx.user.id
    if (!isOwner) {
      const { data: billRow } = await supabase
        .from("bills")
        .select("household_id, resident_id")
        .eq("id", payment.bill_id)
        .eq("tenant_id", tenant.tenantId)
        .maybeSingle()

      const bill = billRow as {
        household_id: string | null
        resident_id: string | null
      } | null

      if (bill) {
        isOwner = await checkResidentOwnsBill({
          supabase,
          tenantId: tenant.tenantId,
          billHouseholdId: bill.household_id,
          billResidentId: bill.resident_id,
        })
      }
    }

    if (!isOwner) {
      return NextResponse.json(
        { error: "Anda tidak memiliki izin untuk melihat bukti pembayaran ini." },
        { status: 403 }
      )
    }
  }

  if (
    !payment.proof_storage_path ||
    !isValidPaymentProofPath(payment.proof_storage_path) ||
    !paymentProofPathBelongsTo(
      payment.proof_storage_path,
      tenant.tenantId,
      payment.id
    )
  ) {
    return NextResponse.json(
      { error: "Bukti pembayaran belum tersedia." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    )
  }

  const [pendingRes, retiredRes] = await Promise.all([
    supabase.rpc("is_storage_object_deletion_pending", {
      p_bucket_id: PAYMENT_PROOFS_BUCKET,
      p_object_path: payment.proof_storage_path,
    }),
    supabase.rpc("is_storage_object_path_retired", {
      p_bucket_id: PAYMENT_PROOFS_BUCKET,
      p_object_path: payment.proof_storage_path,
    }),
  ])

  if (
    pendingRes.error ||
    retiredRes.error ||
    pendingRes.data === true ||
    retiredRes.data === true
  ) {
    return NextResponse.json(
      { error: "Bukti pembayaran tidak tersedia." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    )
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(PAYMENT_PROOFS_BUCKET)
    .download(payment.proof_storage_path)

  if (downloadErr || !blob) {
    return NextResponse.json(
      { error: "Gagal mengambil berkas bukti pembayaran." },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    )
  }

  const { contentType, extension } = inferContentTypeFromStoragePath(
    payment.proof_storage_path
  )
  const url = new URL(request.url)
  const forceDownload = url.searchParams.get("download") === "1"
  const dispositionType = forceDownload ? "attachment" : "inline"
  const fileBuffer = await blob.arrayBuffer()

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${dispositionType}; filename="bukti-pembayaran-${payment.id.slice(0, 8)}.${extension}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
