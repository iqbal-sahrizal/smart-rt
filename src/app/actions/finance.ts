"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireAdminContext, requireResidentContext } from "@/lib/auth/guards"
import { invokeNotificationEnqueueRpc } from "@/lib/notifications/enqueue-rpc"
import {
  cancelBillSchema,
  createBillSchema,
  createCashCategorySchema,
  createCashExpenseSchema,
  createDuesSchema,
  deleteDuesSchema,
  generateBillsSchema,
  refundPaymentSchema,
  rejectPaymentSchema,
  retryPaymentProofSchema,
  submitResidentPaymentSchema,
  toggleCashCategorySchema,
  updateBillSchema,
  updateCashExpenseSchema,
  updateDuesSchema,
  verifyPaymentSchema,
} from "@/lib/finance/schemas"
import {
  buildPaymentProofPath,
  findUploadedPaymentProofPath,
  PAYMENT_PROOFS_BUCKET,
  validatePaymentProofFile,
  type ValidatedPaymentProof,
} from "@/lib/finance/storage"
import {
  canManageBills,
  canManageDues,
  formatIdr,
  isIncompletePaymentStale,
  type DuesTargetScope,
  type FinanceFormActionState,
} from "@/lib/finance/types"
import { checkResidentOwnsBill } from "@/lib/finance/ownership"
import { isValidUuid } from "@/lib/residents/schemas"
import { createClient } from "@/lib/supabase/server"

function getStringField(formData: FormData, key: string): string {
  const val = formData.get(key)
  return typeof val === "string" ? val : ""
}

function getStringArrayField(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string")
}

function revalidateFinancePaths() {
  revalidatePath("/dues")
  revalidatePath("/bills")
  revalidatePath("/payments")
  revalidatePath("/cash")
  revalidatePath("/resident/bills")
  revalidatePath("/")
  revalidatePath("/resident")
}

export async function createDuesAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageDues(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk membuat konfigurasi iuran. Hanya Ketua RT atau Bendahara yang diizinkan.",
    }
  }

  const parsed = createDuesSchema.safeParse({
    name: getStringField(formData, "name"),
    description: getStringField(formData, "description"),
    amount: getStringField(formData, "amount"),
    billingCycle: getStringField(formData, "billingCycle"),
    targetScope: getStringField(formData, "targetScope"),
    isActive: formData.has("isActive")
      ? getStringField(formData, "isActive") || "true"
      : "false",
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali isian konfigurasi iuran yang belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: created, error } = await supabase
    .from("dues")
    .insert({
      tenant_id: tenant.tenantId,
      name: input.name,
      description: input.description,
      amount: input.amount,
      billing_cycle: input.billingCycle,
      target_scope: input.targetScope,
      is_active: input.isActive,
    })
    .select("id")
    .single()

  if (error || !created) {
    return {
      error:
        error?.code === "42501"
          ? "Anda tidak memiliki izin database untuk membuat konfigurasi iuran."
          : "Gagal menyimpan konfigurasi iuran baru. Silakan coba lagi.",
    }
  }

  revalidateFinancePaths()
  redirect(`/dues/${(created as { id: string }).id}?created=1`)
}

export async function updateDuesAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageDues(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk mengubah konfigurasi iuran. Hanya Ketua RT atau Bendahara yang diizinkan.",
    }
  }

  const parsed = updateDuesSchema.safeParse({
    dueId: getStringField(formData, "dueId"),
    name: getStringField(formData, "name"),
    description: getStringField(formData, "description"),
    amount: getStringField(formData, "amount"),
    billingCycle: getStringField(formData, "billingCycle"),
    targetScope: getStringField(formData, "targetScope"),
    isActive: formData.has("isActive")
      ? getStringField(formData, "isActive") || "true"
      : "false",
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali perubahan konfigurasi iuran yang belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: existingRow } = await supabase
    .from("dues")
    .select("id, target_scope")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.dueId)
    .maybeSingle()

  if (!existingRow) {
    return { error: "Konfigurasi iuran tidak ditemukan pada RT ini." }
  }

  const existing = existingRow as { id: string; target_scope: DuesTargetScope }

  if (existing.target_scope !== input.targetScope) {
    const { count: existingBillCount } = await supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.tenantId)
      .eq("due_id", input.dueId)

    if ((existingBillCount ?? 0) > 0) {
      return {
        error:
          "Cakupan target tidak dapat diubah karena konfigurasi iuran ini sudah memiliki tagihan terdaftar.",
        fieldErrors: {
          targetScope: [
            "Cakupan target harus tetap sama selama sudah ada tagihan terkait.",
          ],
        },
      }
    }
  }

  const { error } = await supabase
    .from("dues")
    .update({
      name: input.name,
      description: input.description,
      amount: input.amount,
      billing_cycle: input.billingCycle,
      target_scope: input.targetScope,
      is_active: input.isActive,
    })
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.dueId)

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Anda tidak memiliki izin database untuk memperbarui konfigurasi iuran."
          : "Gagal menyimpan perubahan konfigurasi iuran.",
    }
  }

  revalidateFinancePaths()
  revalidatePath(`/dues/${input.dueId}`)
  redirect(`/dues/${input.dueId}?updated=1`)
}

export async function deleteDuesAction(
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageDues(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk menghapus konfigurasi iuran. Hanya Ketua RT atau Bendahara yang diizinkan.",
    }
  }

  const parsed = deleteDuesSchema.safeParse({
    dueId: getStringField(formData, "dueId"),
  })

  if (!parsed.success) {
    return { error: "ID konfigurasi iuran tidak valid." }
  }

  const { dueId } = parsed.data
  const supabase = await createClient()

  const { count: billCount } = await supabase
    .from("bills")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.tenantId)
    .eq("due_id", dueId)

  if ((billCount ?? 0) > 0) {
    return {
      error:
        "Konfigurasi iuran ini tidak dapat dihapus karena sudah direferensikan oleh tagihan warga. Nonaktifkan status iuran jika tidak ingin digunakan lagi.",
    }
  }

  const { error } = await supabase
    .from("dues")
    .delete()
    .eq("tenant_id", tenant.tenantId)
    .eq("id", dueId)

  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Konfigurasi iuran tidak dapat dihapus karena masih digunakan oleh tagihan warga."
          : "Gagal menghapus konfigurasi iuran. Silakan coba lagi.",
    }
  }

  revalidateFinancePaths()
  redirect("/dues?deleted=1")
}

export async function createBillAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk membuat tagihan. Hanya Bendahara yang diizinkan oleh kebijakan keamanan database.",
    }
  }

  const parsed = createBillSchema.safeParse({
    dueId: getStringField(formData, "dueId"),
    targetId: getStringField(formData, "targetId"),
    periodYear: getStringField(formData, "periodYear"),
    periodMonth: getStringField(formData, "periodMonth"),
    amount: getStringField(formData, "amount"),
    dueDate: getStringField(formData, "dueDate"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali isian tagihan yang masih belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: dueRow } = await supabase
    .from("dues")
    .select("id, target_scope, is_active")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.dueId)
    .maybeSingle()

  if (!dueRow) {
    return {
      error: "Konfigurasi iuran tidak ditemukan pada RT ini.",
      fieldErrors: { dueId: ["Pilih jenis iuran dari RT Anda."] },
    }
  }

  const due = dueRow as {
    id: string
    target_scope: DuesTargetScope
    is_active: boolean
  }

  if (!due.is_active) {
    return {
      error: "Konfigurasi iuran yang dipilih berstatus nonaktif.",
      fieldErrors: {
        dueId: ["Aktifkan konfigurasi iuran terlebih dahulu atau pilih iuran aktif lainnya."],
      },
    }
  }

  if (due.target_scope === "household") {
    const { data: hh } = await supabase
      .from("households")
      .select("id, status")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", input.targetId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!hh || (hh as { status: string }).status !== "active") {
      return {
        error: "Kartu Keluarga target tidak ditemukan atau tidak aktif pada RT ini.",
        fieldErrors: {
          targetId: ["Pilih Kartu Keluarga aktif yang terdaftar pada RT ini."],
        },
      }
    }
  } else {
    const { data: res } = await supabase
      .from("residents")
      .select("id, residency_status")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", input.targetId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!res || (res as { residency_status: string }).residency_status !== "aktif") {
      return {
        error: "Warga target tidak ditemukan atau tidak berstatus aktif pada RT ini.",
        fieldErrors: {
          targetId: ["Pilih warga aktif yang terdaftar pada RT ini."],
        },
      }
    }
  }

  const { data: created, error } = await supabase
    .from("bills")
    .insert({
      tenant_id: tenant.tenantId,
      due_id: due.id,
      household_id: due.target_scope === "household" ? input.targetId : null,
      resident_id: due.target_scope === "resident" ? input.targetId : null,
      period_year: input.periodYear,
      period_month: input.periodMonth,
      amount: input.amount,
      paid_amount: 0,
      due_date: input.dueDate,
      status: "unpaid",
    })
    .select("id")
    .single()

  if (error || !created) {
    if (error?.code === "23505") {
      return {
        error:
          "Tagihan untuk iuran, target, dan periode bulan/tahun ini sudah pernah dibuat dan belum dibatalkan.",
      }
    }
    return {
      error:
        error?.code === "42501"
          ? "Anda tidak memiliki izin database untuk menerbitkan tagihan."
          : "Gagal menyimpan tagihan baru. Silakan coba lagi.",
    }
  }

  const createdBillId = (created as { id: string }).id
  await invokeNotificationEnqueueRpc(supabase, "notify_bill_issued", {
    p_bill_id: createdBillId,
  })

  revalidateFinancePaths()
  redirect(`/bills/${createdBillId}?created=1`)
}

export async function generateBillsAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk menerbitkan tagihan massal. Hanya Bendahara yang diizinkan oleh kebijakan keamanan database.",
    }
  }

  const parsed = generateBillsSchema.safeParse({
    dueId: getStringField(formData, "dueId"),
    targetMode: getStringField(formData, "targetMode"),
    selectedTargetIds: getStringArrayField(formData, "selectedTargetIds"),
    periodYear: getStringField(formData, "periodYear"),
    periodMonth: getStringField(formData, "periodMonth"),
    amount: getStringField(formData, "amount"),
    dueDate: getStringField(formData, "dueDate"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali parameter penerbitan tagihan massal.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: dueRow } = await supabase
    .from("dues")
    .select("id, target_scope, is_active")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.dueId)
    .maybeSingle()

  if (!dueRow) {
    return { error: "Konfigurasi iuran tidak ditemukan pada RT ini." }
  }

  const due = dueRow as {
    id: string
    target_scope: DuesTargetScope
    is_active: boolean
  }

  if (!due.is_active) {
    return {
      error:
        "Konfigurasi iuran berstatus nonaktif. Aktifkan terlebih dahulu sebelum menerbitkan tagihan.",
    }
  }

  // Resolve verified tenant target IDs
  let verifiedTargetIds: string[] = []
  if (due.target_scope === "household") {
    let q = supabase
      .from("households")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
      .eq("status", "active")

    if (input.targetMode === "selected") {
      q = q.in("id", input.selectedTargetIds)
    }

    const { data: validHouseholds } = await q
    verifiedTargetIds = ((validHouseholds ?? []) as Array<{ id: string }>).map(
      (h) => h.id
    )
  } else {
    let q = supabase
      .from("residents")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .is("deleted_at", null)
      .eq("residency_status", "aktif")

    if (input.targetMode === "selected") {
      q = q.in("id", input.selectedTargetIds)
    }

    const { data: validResidents } = await q
    verifiedTargetIds = ((validResidents ?? []) as Array<{ id: string }>).map(
      (r) => r.id
    )
  }

  if (
    input.targetMode === "selected" &&
    verifiedTargetIds.length !== input.selectedTargetIds.length
  ) {
    return {
      error:
        "Sebagian target yang dipilih tidak ditemukan atau tidak aktif pada RT ini.",
      fieldErrors: {
        selectedTargetIds: [
          "Pastikan seluruh target yang dipilih terdaftar aktif pada RT ini.",
        ],
      },
    }
  }

  if (verifiedTargetIds.length === 0) {
    return {
      error:
        due.target_scope === "household"
          ? "Tidak ada Kartu Keluarga aktif yang dapat ditagih pada RT ini."
          : "Tidak ada warga aktif yang dapat ditagih pada RT ini.",
    }
  }

  // Check already-existing non-cancelled bills for (due_id, period_year, period_month)
  const { data: existingRows } = await supabase
    .from("bills")
    .select("household_id, resident_id")
    .eq("tenant_id", tenant.tenantId)
    .eq("due_id", due.id)
    .eq("period_year", input.periodYear)
    .eq("period_month", input.periodMonth)
    .neq("status", "cancelled")

  const existingTargetSet = new Set(
    ((existingRows ?? []) as Array<{
      household_id: string | null
      resident_id: string | null
    }>)
      .map((row) =>
        due.target_scope === "household" ? row.household_id : row.resident_id
      )
      .filter((id): id is string => Boolean(id))
  )

  const targetsToInsert = verifiedTargetIds.filter(
    (id) => !existingTargetSet.has(id)
  )
  let skippedCount = verifiedTargetIds.length - targetsToInsert.length
  let createdCount = 0
  let failedCount = 0

  if (targetsToInsert.length > 0) {
    const insertPayload = targetsToInsert.map((targetId) => ({
      tenant_id: tenant.tenantId,
      due_id: due.id,
      household_id: due.target_scope === "household" ? targetId : null,
      resident_id: due.target_scope === "resident" ? targetId : null,
      period_year: input.periodYear,
      period_month: input.periodMonth,
      amount: input.amount,
      paid_amount: 0,
      due_date: input.dueDate,
      status: "unpaid" as const,
    }))

    const { error: batchErr } = await supabase
      .from("bills")
      .insert(insertPayload)

    if (!batchErr) {
      createdCount = insertPayload.length
    } else {
      // Fallback per-row insertion so concurrent duplicates (23505) skip safely while valid rows persist
      for (const row of insertPayload) {
        const { error: rowErr } = await supabase.from("bills").insert(row)
        if (!rowErr) {
          createdCount += 1
        } else if (rowErr.code === "23505") {
          skippedCount += 1
        } else {
          failedCount += 1
        }
      }
    }
  }

  if (createdCount > 0) {
    const { data: newBills, error: fetchBillsError } = await supabase
      .from("bills")
      .select("id")
      .eq("tenant_id", tenant.tenantId)
      .eq("due_id", due.id)
      .eq("period_year", input.periodYear)
      .eq("period_month", input.periodMonth)
      .neq("status", "cancelled")

    if (fetchBillsError) {
      console.error(
        `[NotificationEngine] Failed to fetch newly generated bills for notification (${fetchBillsError.code ?? "UNKNOWN"}): ${fetchBillsError.message}`
      )
    } else if (newBills && newBills.length > 0) {
      await Promise.all(
        newBills.map((b) =>
          invokeNotificationEnqueueRpc(supabase, "notify_bill_issued", {
            p_bill_id: (b as { id: string }).id,
          })
        )
      )
    }
  }

  revalidateFinancePaths()

  if (createdCount === 0 && skippedCount > 0 && failedCount === 0) {
    return {
      error: null,
      successMessage: `Seluruh ${skippedCount} target sudah memiliki tagihan aktif pada periode tersebut, sehingga tidak ada duplikat baru yang diterbitkan.`,
      generationResult: {
        createdCount,
        skippedCount,
        failedCount,
        totalNominal: 0,
      },
    }
  }

  if (createdCount === 0 && failedCount > 0) {
    return {
      error:
        "Gagal menerbitkan tagihan massal. Periksa izin dan status target Anda.",
      generationResult: {
        createdCount,
        skippedCount,
        failedCount,
        totalNominal: 0,
      },
    }
  }

  return {
    error:
      failedCount > 0
        ? `Sebagian tagihan gagal dibuat (${failedCount} gagal, ${createdCount} berhasil, ${skippedCount} dilewati karena sudah ada).`
        : null,
    successMessage:
      failedCount === 0
        ? `Berhasil menerbitkan ${createdCount} tagihan baru${skippedCount > 0 ? ` (${skippedCount} target dilewati karena sudah memiliki tagihan pada periode ini)` : ""}.`
        : null,
    generationResult: {
      createdCount,
      skippedCount,
      failedCount,
      totalNominal: createdCount * input.amount,
    },
  }
}

export async function updateBillAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk mengubah tagihan. Hanya Bendahara yang diizinkan.",
    }
  }

  const parsed = updateBillSchema.safeParse({
    billId: getStringField(formData, "billId"),
    amount: getStringField(formData, "amount"),
    dueDate: getStringField(formData, "dueDate"),
    status: getStringField(formData, "status"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali perubahan data tagihan yang belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: existingRow } = await supabase
    .from("bills")
    .select("id, amount, paid_amount, status")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.billId)
    .maybeSingle()

  if (!existingRow) {
    return { error: "Tagihan tidak ditemukan pada RT ini." }
  }

  const existing = existingRow as {
    id: string
    amount: number | string
    paid_amount: number | string
    status: string
  }

  const existingAmount = Number(existing.amount)
  const paidAmount = Number(existing.paid_amount)

  if (
    existing.status === "paid" ||
    existing.status === "refunded" ||
    existing.status === "pending_verification"
  ) {
    return {
      error:
        "Tagihan yang sudah lunas, sedang menunggu verifikasi pembayaran, atau dikembalikan tidak dapat diubah melalui pengelolaan tagihan.",
    }
  }

  if (paidAmount > 0 && input.amount !== existingAmount) {
    return {
      error:
        "Nominal tagihan tidak dapat diubah karena sudah terdapat pembayaran sebagian pada tagihan ini.",
      fieldErrors: {
        amount: ["Nominal terkunci setelah ada pembayaran masuk."],
      },
    }
  }

  if (paidAmount > 0 && input.status === "cancelled") {
    return {
      error:
        "Tagihan yang sudah memiliki pembayaran masuk tidak dapat dibatalkan.",
    }
  }

  const { error } = await supabase
    .from("bills")
    .update({
      amount: input.amount,
      due_date: input.dueDate,
      status: input.status,
    })
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.billId)

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Anda tidak memiliki izin database untuk memperbarui tagihan."
          : "Gagal menyimpan perubahan tagihan. Silakan coba lagi.",
    }
  }

  revalidateFinancePaths()
  revalidatePath(`/bills/${input.billId}`)
  redirect(`/bills/${input.billId}?updated=1`)
}

export async function cancelBillAction(
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk membatalkan tagihan. Hanya Bendahara yang diizinkan.",
    }
  }

  const parsed = cancelBillSchema.safeParse({
    billId: getStringField(formData, "billId"),
  })

  if (!parsed.success) {
    return { error: "ID tagihan tidak valid." }
  }

  const { billId } = parsed.data
  const supabase = await createClient()

  const { data: existingRow } = await supabase
    .from("bills")
    .select("id, paid_amount, status")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", billId)
    .maybeSingle()

  if (!existingRow) {
    return { error: "Tagihan tidak ditemukan pada RT ini." }
  }

  const existing = existingRow as {
    id: string
    paid_amount: number | string
    status: string
  }

  if (
    Number(existing.paid_amount) > 0 ||
    existing.status === "paid" ||
    existing.status === "refunded" ||
    existing.status === "pending_verification"
  ) {
    return {
      error:
        "Tagihan yang sudah memiliki pembayaran atau sedang diproses tidak dapat dibatalkan.",
    }
  }

  if (existing.status === "cancelled") {
    redirect(`/bills/${billId}`)
  }

  const { error } = await supabase
    .from("bills")
    .update({ status: "cancelled" })
    .eq("tenant_id", tenant.tenantId)
    .eq("id", billId)

  if (error) {
    return {
      error: "Gagal membatalkan tagihan. Silakan coba lagi.",
    }
  }

  revalidateFinancePaths()
  revalidatePath(`/bills/${billId}`)
  redirect(`/bills/${billId}?cancelled=1`)
}

function formatRpcErrorMessage(
  err: { code?: string; message?: string } | null | undefined,
  fallback: string
): string {
  if (!err) return fallback
  const msg = err.message ?? ""
  if (err.code === "42501" || msg.includes("Forbidden")) {
    return "Anda tidak memiliki izin database untuk memproses pembayaran ini."
  }
  if (msg.includes("Only pending payments can be verified")) {
    return "Pembayaran ini sudah diproses sebelumnya dan tidak lagi berstatus Menunggu Verifikasi."
  }
  if (msg.includes("Only pending payments can be rejected")) {
    return "Pembayaran ini sudah diproses sebelumnya dan tidak dapat ditolak lagi."
  }
  if (msg.includes("Invalid or inactive cash_category_id")) {
    return "Kategori kas masuk tidak valid atau tidak aktif. Pilih atau buat kategori kas terlebih dahulu."
  }
  if (msg.includes("Invariant violation: net paid")) {
    return "Total pembayaran terverifikasi melebihi nominal tagihan."
  }
  if (err.code === "23505" || msg.includes("uq_cash_tx_payment")) {
    return "Transaksi kas untuk pembayaran ini sudah tercatat sebelumnya."
  }
  if (msg.includes("Rejection reason must not be empty")) {
    return "Alasan penolakan wajib diisi."
  }
  if (msg.includes("Only verified payments can be refunded")) {
    return "Hanya pembayaran berstatus Terverifikasi yang dapat dikembalikan dananya."
  }
  if (msg.includes("Refund reason must not be empty")) {
    return "Alasan pengembalian dana wajib diisi."
  }
  if (msg.includes("Refund amount must be positive")) {
    return "Nominal pengembalian dana harus lebih dari Rp 0."
  }
  if (msg.includes("Refund amount exceeds remaining refundable payment amount")) {
    return "Nominal pengembalian dana melebihi sisa dana yang dapat direfund dari pembayaran ini."
  }
  return fallback
}

async function attachOrUploadProofForPendingPayment({
  supabase,
  tenantId,
  paymentId,
  validatedFile,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  tenantId: string
  paymentId: string
  validatedFile: ValidatedPaymentProof | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let proofPath = await findUploadedPaymentProofPath({
    supabase,
    tenantId,
    paymentId,
  })

  if (!proofPath) {
    if (!validatedFile) {
      return {
        ok: false,
        error: "Berkas bukti pembayaran wajib diunggah.",
      }
    }

    proofPath = buildPaymentProofPath(
      tenantId,
      paymentId,
      validatedFile.extension
    )

    const { error: uploadErr } = await supabase.storage
      .from(PAYMENT_PROOFS_BUCKET)
      .upload(proofPath, validatedFile.buffer, {
        contentType: validatedFile.mimeType,
        upsert: false,
      })

    if (uploadErr) {
      return {
        ok: false,
        error:
          "Catatan pembayaran tersimpan, namun gagal mengunggah berkas bukti ke penyimpanan privat. Gunakan tombol pulihkan pengajuan pada halaman tagihan untuk mencoba ulang tanpa duplikasi.",
      }
    }
  }

  const { error: attachErr } = await supabase.rpc("attach_payment_proof", {
    p_payment_id: paymentId,
    p_storage_path: proofPath,
  })

  if (attachErr) {
    return {
      ok: false,
      error:
        "Berkas bukti sudah tersimpan di penyimpanan privat, namun gagal ditautkan ke pengajuan. Gunakan tombol Lanjutkan Pengajuan pada halaman tagihan.",
    }
  }

  return { ok: true }
}

export async function submitResidentPaymentAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { ctx, tenant } = await requireResidentContext()

  const parsed = submitResidentPaymentSchema.safeParse({
    billId: getStringField(formData, "billId"),
    paymentMethod: getStringField(formData, "paymentMethod"),
    amount: getStringField(formData, "amount"),
    notes: getStringField(formData, "notes"),
    idempotencyNonce: getStringField(formData, "idempotencyNonce"),
    recoveryPaymentId: getStringField(formData, "recoveryPaymentId"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali data pembayaran yang belum sesuai.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const fileValidation = await validatePaymentProofFile(formData.get("proof"))
  if (!fileValidation.ok) {
    return {
      error: fileValidation.error,
      fieldErrors: { proof: [fileValidation.error] },
    }
  }

  const input = parsed.data
  const supabase = await createClient()

  const { data: billRow, error: billErr } = await supabase
    .from("bills")
    .select("id, tenant_id, household_id, resident_id, amount, paid_amount, status")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", input.billId)
    .maybeSingle()

  if (billErr || !billRow) {
    return { error: "Tagihan tidak ditemukan atau tidak tersedia untuk akun Anda." }
  }

  const bill = billRow as {
    id: string
    tenant_id: string
    household_id: string | null
    resident_id: string | null
    amount: number | string
    paid_amount: number | string
    status: string
  }

  const ownsBill = await checkResidentOwnsBill({
    supabase,
    tenantId: tenant.tenantId,
    billHouseholdId: bill.household_id,
    billResidentId: bill.resident_id,
  })

  if (!ownsBill) {
    return { error: "Tagihan ini bukan milik Anda atau kartu keluarga Anda." }
  }

  if (
    bill.status === "paid" ||
    bill.status === "cancelled" ||
    bill.status === "refunded"
  ) {
    return {
      error: "Tagihan ini sudah selesai/dibatalkan dan tidak dapat dibayar lagi.",
    }
  }

  const billAmount = Number(bill.amount)
  const paidAmount = Number(bill.paid_amount)
  const remainingAmount = Math.max(0, Math.round((billAmount - paidAmount) * 100) / 100)

  if (remainingAmount <= 0) {
    return { error: "Tagihan ini tidak memiliki sisa kewajiban yang perlu dibayar." }
  }

  if (input.amount > remainingAmount) {
    const msg = `Nominal pembayaran melebihi sisa tagihan (${formatIdr(remainingAmount)}).`
    return {
      error: msg,
      fieldErrors: { amount: [msg] },
    }
  }

  const { data: existingPayments } = await supabase
    .from("payments")
    .select(
      "id, paid_by_user_id, amount, payment_method, status, proof_storage_path, created_at, paid_at"
    )
    .eq("tenant_id", tenant.tenantId)
    .eq("bill_id", bill.id)
    .eq("payment_type", "payment")
    .order("created_at", { ascending: false })

  const paymentRows = (existingPayments ?? []) as Array<{
    id: string
    paid_by_user_id: string | null
    amount: number | string
    payment_method: string
    status: string
    proof_storage_path: string | null
    created_at: string
    paid_at: string
  }>

  const hasSubmittedPending = paymentRows.some(
    (p) => p.status === "pending" && p.proof_storage_path !== null
  )

  if (hasSubmittedPending || bill.status === "pending_verification") {
    return {
      error:
        "Pembayaran sebelumnya sedang menunggu verifikasi Bendahara. Anda dapat mengirim ulang hanya jika pembayaran tersebut ditolak.",
    }
  }

  const nowMs = Date.now()
  let paymentId: string | null = null

  if (input.recoveryPaymentId) {
    const targetDraft = paymentRows.find((p) => p.id === input.recoveryPaymentId)
    if (
      !targetDraft ||
      targetDraft.status !== "pending" ||
      targetDraft.proof_storage_path !== null ||
      targetDraft.paid_by_user_id !== ctx.user.id ||
      isIncompletePaymentStale(targetDraft.created_at ?? targetDraft.paid_at, nowMs)
    ) {
      return {
        error:
          "Pengajuan yang dipilih tidak memenuhi syarat pemulihan atau sudah kedaluwarsa. Silakan ajukan pembayaran baru.",
      }
    }
    if (
      Number(targetDraft.amount) !== input.amount ||
      targetDraft.payment_method !== input.paymentMethod
    ) {
      return {
        error:
          "Nominal atau metode pengajuan yang dipulihkan tidak dapat diubah. Gunakan form pemulihan khusus atau ajukan pembayaran baru.",
      }
    }
    paymentId = targetDraft.id
  } else {
    const matchingDraft = paymentRows.find(
      (p) =>
        p.status === "pending" &&
        p.proof_storage_path === null &&
        p.paid_by_user_id === ctx.user.id &&
        !isIncompletePaymentStale(p.created_at ?? p.paid_at, nowMs) &&
        Number(p.amount) === input.amount &&
        p.payment_method === input.paymentMethod
    )
    if (matchingDraft) {
      paymentId = matchingDraft.id
    }
  }

  if (!paymentId) {
    const idempotencyKey = input.idempotencyNonce
      ? `res:${ctx.user.id}:${bill.id}:${input.idempotencyNonce}`
      : `res:${ctx.user.id}:${bill.id}:${crypto.randomUUID()}`

    const { data: createdPayment, error: insertErr } = await supabase
      .from("payments")
      .insert({
        tenant_id: tenant.tenantId,
        bill_id: bill.id,
        payment_type: "payment",
        paid_by_user_id: ctx.user.id,
        amount: input.amount,
        payment_method: input.paymentMethod,
        status: "pending",
        proof_storage_path: null,
        notes: input.notes,
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single()

    if (insertErr || !createdPayment) {
      if (insertErr?.code === "23505") {
        const { data: idempotentRow } = await supabase
          .from("payments")
          .select("id, status, proof_storage_path, created_at, paid_at")
          .eq("tenant_id", tenant.tenantId)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle()

        const existingByKey = idempotentRow as {
          id: string
          status: string
          proof_storage_path: string | null
          created_at: string
          paid_at: string
        } | null

        if (existingByKey?.proof_storage_path) {
          redirect(`/resident/bills/${bill.id}?submitted=1`)
        }
        if (
          existingByKey &&
          existingByKey.status === "pending" &&
          existingByKey.proof_storage_path === null &&
          !isIncompletePaymentStale(
            existingByKey.created_at ?? existingByKey.paid_at,
            nowMs
          )
        ) {
          paymentId = existingByKey.id
        } else {
          return {
            error:
              "Pengajuan dengan kunci idempotensi ini sudah tidak dapat diproses ulang.",
          }
        }
      } else {
        return {
          error:
            insertErr?.code === "42501"
              ? "Anda tidak memiliki izin database untuk mengirim pembayaran tagihan ini."
              : "Gagal mencatat pengajuan pembayaran. Silakan coba lagi.",
        }
      }
    } else {
      paymentId = (createdPayment as { id: string }).id
    }
  }

  const attachResult = await attachOrUploadProofForPendingPayment({
    supabase,
    tenantId: tenant.tenantId,
    paymentId,
    validatedFile: fileValidation.file,
  })

  if (!attachResult.ok) {
    return { error: attachResult.error }
  }

  revalidateFinancePaths()
  revalidatePath(`/bills/${bill.id}`)
  revalidatePath(`/resident/bills/${bill.id}`)
  redirect(`/resident/bills/${bill.id}?submitted=1`)
}

export async function retryPaymentProofAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireResidentContext()

  const parsed = retryPaymentProofSchema.safeParse({
    billId: getStringField(formData, "billId"),
    paymentId: getStringField(formData, "paymentId"),
  })

  if (!parsed.success) {
    return {
      error: "Data pengajuan pembayaran tidak valid untuk dipulihkan.",
    }
  }

  const { billId, paymentId } = parsed.data
  const supabase = await createClient()

  const [{ data: billRow }, { data: paymentRow }] = await Promise.all([
    supabase
      .from("bills")
      .select(
        "id, tenant_id, household_id, resident_id, amount, paid_amount, status"
      )
      .eq("tenant_id", tenant.tenantId)
      .eq("id", billId)
      .maybeSingle(),
    supabase
      .from("payments")
      .select(
        "id, tenant_id, bill_id, payment_type, amount, status, proof_storage_path, created_at, paid_at"
      )
      .eq("tenant_id", tenant.tenantId)
      .eq("id", paymentId)
      .maybeSingle(),
  ])

  if (!billRow || !paymentRow) {
    return { error: "Tagihan atau pengajuan pembayaran tidak ditemukan." }
  }

  const bill = billRow as {
    id: string
    household_id: string | null
    resident_id: string | null
    amount: number | string
    paid_amount: number | string
    status: string
  }

  const ownsBill = await checkResidentOwnsBill({
    supabase,
    tenantId: tenant.tenantId,
    billHouseholdId: bill.household_id,
    billResidentId: bill.resident_id,
  })

  if (!ownsBill) {
    return { error: "Tagihan ini bukan milik Anda atau kartu keluarga Anda." }
  }

  if (
    bill.status === "paid" ||
    bill.status === "cancelled" ||
    bill.status === "refunded" ||
    bill.status === "pending_verification"
  ) {
    return {
      error:
        "Tagihan ini sedang diverifikasi atau sudah selesai sehingga pengajuan tidak dapat dilanjutkan.",
    }
  }

  const payment = paymentRow as {
    id: string
    bill_id: string
    payment_type: string
    amount: number | string
    status: string
    proof_storage_path: string | null
    created_at: string
    paid_at: string
  }

  if (payment.bill_id !== bill.id || payment.payment_type !== "payment") {
    return { error: "Pengajuan pembayaran tidak cocok dengan tagihan ini." }
  }

  if (payment.status !== "pending") {
    return {
      error:
        "Hanya pengajuan berstatus Menunggu Verifikasi tanpa bukti yang dapat dipulihkan. Pengajuan yang sudah terverifikasi, ditolak, atau direfund tidak dapat diubah.",
    }
  }

  if (payment.proof_storage_path !== null) {
    return {
      error:
        "Bukti pembayaran untuk pengajuan ini sudah terlampir dan tidak dapat ditimpa.",
    }
  }

  if (isIncompletePaymentStale(payment.created_at ?? payment.paid_at)) {
    return {
      error:
        "Draft pengajuan ini sudah melewati batas waktu 24 jam (kedaluwarsa). Silakan buat pengajuan pembayaran baru.",
    }
  }

  const remainingAmount = Math.max(
    0,
    Math.round((Number(bill.amount) - Number(bill.paid_amount)) * 100) / 100
  )
  if (Number(payment.amount) > remainingAmount) {
    return {
      error: `Nominal pengajuan (${formatIdr(Number(payment.amount))}) melebihi sisa tagihan saat ini (${formatIdr(remainingAmount)}). Silakan buat pengajuan baru.`,
    }
  }

  const existingStoragePath = await findUploadedPaymentProofPath({
    supabase,
    tenantId: tenant.tenantId,
    paymentId: payment.id,
  })

  let validatedFile: ValidatedPaymentProof | null = null
  if (!existingStoragePath) {
    const fileValidation = await validatePaymentProofFile(formData.get("proof"))
    if (!fileValidation.ok) {
      return {
        error: fileValidation.error,
        fieldErrors: { proof: [fileValidation.error] },
      }
    }
    validatedFile = fileValidation.file
  }

  const attachResult = await attachOrUploadProofForPendingPayment({
    supabase,
    tenantId: tenant.tenantId,
    paymentId: payment.id,
    validatedFile,
  })

  if (!attachResult.ok) {
    return { error: attachResult.error }
  }

  revalidateFinancePaths()
  revalidatePath(`/bills/${bill.id}`)
  revalidatePath(`/resident/bills/${bill.id}`)
  redirect(`/resident/bills/${bill.id}?submitted=1`)
}

export async function verifyPaymentAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk memverifikasi pembayaran. Hanya Bendahara yang diizinkan.",
    }
  }

  const parsed = verifyPaymentSchema.safeParse({
    paymentId: getStringField(formData, "paymentId"),
    cashCategoryId: getStringField(formData, "cashCategoryId"),
    notes: getStringField(formData, "notes"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali kategori kas masuk atau catatan verifikasi.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { paymentId, cashCategoryId, notes } = parsed.data
  const supabase = await createClient()

  const { data: existingRow } = await supabase
    .from("payments")
    .select("id, bill_id, tenant_id")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", paymentId)
    .maybeSingle()

  if (!existingRow) {
    return { error: "Pembayaran tidak ditemukan pada RT ini." }
  }

  const existing = existingRow as {
    id: string
    bill_id: string
    tenant_id: string
  }

  const { error } = await supabase.rpc("verify_payment", {
    p_payment_id: paymentId,
    p_cash_category_id: cashCategoryId,
    p_notes: notes,
  })

  if (error) {
    return {
      error: formatRpcErrorMessage(
        error,
        "Gagal memverifikasi pembayaran. Silakan coba lagi."
      ),
    }
  }

  revalidateFinancePaths()
  revalidatePath(`/payments/${paymentId}`)
  revalidatePath(`/bills/${existing.bill_id}`)
  revalidatePath(`/resident/bills/${existing.bill_id}`)
  redirect(`/payments/${paymentId}?verified=1`)
}

export async function rejectPaymentAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk menolak pembayaran. Hanya Bendahara yang diizinkan.",
    }
  }

  const parsed = rejectPaymentSchema.safeParse({
    paymentId: getStringField(formData, "paymentId"),
    reason: getStringField(formData, "reason"),
  })

  if (!parsed.success) {
    return {
      error: "Alasan penolakan wajib diisi dengan jelas.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { paymentId, reason } = parsed.data
  const supabase = await createClient()

  const { data: existingRow } = await supabase
    .from("payments")
    .select("id, bill_id")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", paymentId)
    .maybeSingle()

  if (!existingRow) {
    return { error: "Pembayaran tidak ditemukan pada RT ini." }
  }

  const existing = existingRow as { id: string; bill_id: string }

  const { error } = await supabase.rpc("reject_payment", {
    p_payment_id: paymentId,
    p_reason: reason,
  })

  if (error) {
    return {
      error: formatRpcErrorMessage(
        error,
        "Gagal menolak pembayaran. Silakan coba lagi."
      ),
    }
  }

  revalidateFinancePaths()
  revalidatePath(`/payments/${paymentId}`)
  revalidatePath(`/bills/${existing.bill_id}`)
  revalidatePath(`/resident/bills/${existing.bill_id}`)
  redirect(`/payments/${paymentId}?rejected=1`)
}

export async function refundPaymentAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk memproses pengembalian dana (refund). Hanya Bendahara yang diizinkan.",
    }
  }

  const parsed = refundPaymentSchema.safeParse({
    parentPaymentId: getStringField(formData, "parentPaymentId"),
    amount: getStringField(formData, "amount"),
    cashCategoryId: getStringField(formData, "cashCategoryId"),
    reason: getStringField(formData, "reason"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali nominal, kategori kas keluar, dan alasan refund.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { parentPaymentId, amount, cashCategoryId, reason } = parsed.data
  const supabase = await createClient()

  const [{ data: parentRow }, { data: categoryRow }, { data: existingRefunds }] =
    await Promise.all([
      supabase
        .from("payments")
        .select("id, tenant_id, bill_id, payment_type, status, amount")
        .eq("tenant_id", tenant.tenantId)
        .eq("id", parentPaymentId)
        .maybeSingle(),
      supabase
        .from("cash_categories")
        .select("id, tenant_id, type, is_active")
        .eq("tenant_id", tenant.tenantId)
        .eq("id", cashCategoryId)
        .maybeSingle(),
      supabase
        .from("payments")
        .select("id, amount, status")
        .eq("tenant_id", tenant.tenantId)
        .eq("parent_payment_id", parentPaymentId)
        .eq("payment_type", "refund")
        .eq("status", "verified"),
    ])

  if (!parentRow) {
    return { error: "Pembayaran induk tidak ditemukan pada RT ini." }
  }

  const parent = parentRow as {
    id: string
    tenant_id: string
    bill_id: string
    payment_type: string
    status: string
    amount: number | string
  }

  if (parent.payment_type !== "payment") {
    return { error: "Hanya transaksi pembayaran iuran yang dapat direfund." }
  }

  if (parent.status !== "verified") {
    return {
      error:
        "Hanya pembayaran berstatus Terverifikasi yang masih memiliki dana untuk dikembalikan.",
    }
  }

  const category = categoryRow as {
    id: string
    type: string
    is_active: boolean
  } | null

  if (!category || category.type !== "expense" || !category.is_active) {
    return {
      error:
        "Kategori pengeluaran kas tidak valid atau tidak aktif. Pilih atau buat kategori pengeluaran aktif terlebih dahulu.",
      fieldErrors: {
        cashCategoryId: ["Pilih kategori pengeluaran kas yang aktif."],
      },
    }
  }

  const alreadyRefunded = ((existingRefunds ?? []) as Array<{ amount: number | string }>).reduce(
    (sum, r) => sum + Number(r.amount),
    0
  )
  const remainingRefundable = Math.max(
    0,
    Math.round((Number(parent.amount) - alreadyRefunded) * 100) / 100
  )

  if (remainingRefundable <= 0) {
    return { error: "Seluruh dana dari pembayaran ini sudah direfund." }
  }

  if (amount > remainingRefundable) {
    const msg = `Nominal refund melebihi sisa dana yang dapat dikembalikan (${formatIdr(remainingRefundable)}).`
    return {
      error: msg,
      fieldErrors: { amount: [msg] },
    }
  }

  const { error } = await supabase.rpc("refund_payment", {
    p_parent_payment_id: parentPaymentId,
    p_amount: amount,
    p_cash_category_id: cashCategoryId,
    p_reason: reason,
  })

  if (error) {
    return {
      error: formatRpcErrorMessage(
        error,
        "Gagal memproses pengembalian dana (refund). Silakan coba lagi."
      ),
    }
  }

  revalidateFinancePaths()
  revalidatePath(`/payments/${parentPaymentId}`)
  revalidatePath(`/bills/${parent.bill_id}`)
  revalidatePath(`/resident/bills/${parent.bill_id}`)
  redirect(`/payments/${parentPaymentId}?refunded=1`)
}

export async function createCashCategoryAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()
  const source = getStringField(formData, "source").trim()
  const isAllowed =
    source === "cash"
      ? canManageDues(tenant.roles)
      : canManageBills(tenant.roles)

  if (!isAllowed) {
    return {
      error:
        source === "cash"
          ? "Anda tidak memiliki izin untuk membuat kategori kas. Hanya Ketua RT atau Bendahara yang diizinkan."
          : "Anda tidak memiliki izin untuk membuat kategori kas. Hanya Bendahara yang diizinkan.",
    }
  }

  const rawType = getStringField(formData, "type").trim()
  const parsed = createCashCategorySchema.safeParse({
    name: getStringField(formData, "name"),
    type: rawType || "income",
  })

  if (!parsed.success) {
    return {
      error: "Data kategori kas tidak valid.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("cash_categories").insert({
    tenant_id: tenant.tenantId,
    name: parsed.data.name,
    type: parsed.data.type,
    is_active: true,
  })

  const typeLabel = parsed.data.type === "expense" ? "pengeluaran" : "kas masuk"

  if (error) {
    if (error.code === "23505") {
      return {
        error: `Kategori ${typeLabel} dengan nama tersebut sudah ada.`,
      }
    }
    return {
      error:
        error.code === "42501"
          ? "Anda tidak memiliki izin untuk menambahkan kategori kas."
          : `Gagal menambahkan kategori ${typeLabel}.`,
    }
  }

  const returnPaymentId = getStringField(formData, "returnPaymentId").trim()
  revalidatePath("/payments")
  revalidatePath("/cash")
  if (isValidUuid(returnPaymentId)) {
    revalidatePath(`/payments/${returnPaymentId}`)
  }

  return {
    error: null,
    successMessage: `Kategori ${typeLabel} "${parsed.data.name}" berhasil ditambahkan.`,
  }
}

export async function toggleCashCategoryAction(
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageDues(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk mengubah status kategori kas. Hanya Ketua RT atau Bendahara yang diizinkan.",
    }
  }

  const parsed = toggleCashCategorySchema.safeParse({
    categoryId: getStringField(formData, "categoryId"),
    isActive: getStringField(formData, "isActive"),
  })

  if (!parsed.success) {
    return { error: "Parameter kategori kas tidak valid." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("cash_categories")
    .update({ is_active: parsed.data.isActive })
    .eq("tenant_id", tenant.tenantId)
    .eq("id", parsed.data.categoryId)

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Anda tidak memiliki izin database untuk mengubah kategori kas."
          : "Gagal memperbarui status kategori kas.",
    }
  }

  revalidatePath("/payments")
  revalidatePath("/cash")
  return {
    error: null,
    successMessage: parsed.data.isActive
      ? "Kategori kas berhasil diaktifkan."
      : "Kategori kas berhasil dinonaktifkan.",
  }
}

export async function createCashExpenseAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { ctx, tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk mencatat pengeluaran kas. Hanya Bendahara yang diizinkan.",
    }
  }

  const parsed = createCashExpenseSchema.safeParse({
    categoryId: getStringField(formData, "categoryId"),
    amount: getStringField(formData, "amount"),
    transactionDate: getStringField(formData, "transactionDate"),
    description: getStringField(formData, "description"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali rincian pengeluaran kas yang diisi.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { categoryId, amount, transactionDate, description } = parsed.data
  const supabase = await createClient()

  const { data: categoryRow } = await supabase
    .from("cash_categories")
    .select("id, type, is_active")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", categoryId)
    .maybeSingle()

  const category = categoryRow as {
    id: string
    type: string
    is_active: boolean
  } | null

  if (!category || category.type !== "expense" || !category.is_active) {
    return {
      error: "Kategori pengeluaran tidak valid atau sudah dinonaktifkan.",
      fieldErrors: { categoryId: ["Pilih kategori pengeluaran kas yang aktif."] },
    }
  }

  const { error } = await supabase.from("cash_transactions").insert({
    tenant_id: tenant.tenantId,
    category_id: categoryId,
    payment_id: null,
    type: "expense",
    amount,
    transaction_date: transactionDate,
    description,
    created_by: ctx.user.id,
  })

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Anda tidak memiliki izin database untuk mencatat pengeluaran kas."
          : "Gagal menyimpan pengeluaran kas. Silakan coba lagi.",
    }
  }

  revalidateFinancePaths()
  redirect("/cash?created=1")
}

export async function updateCashExpenseAction(
  _prevState: FinanceFormActionState,
  formData: FormData
): Promise<FinanceFormActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageBills(tenant.roles)) {
    return {
      error:
        "Anda tidak memiliki izin untuk mengubah transaksi pengeluaran kas. Hanya Bendahara yang diizinkan.",
    }
  }

  const parsed = updateCashExpenseSchema.safeParse({
    transactionId: getStringField(formData, "transactionId"),
    categoryId: getStringField(formData, "categoryId"),
    amount: getStringField(formData, "amount"),
    transactionDate: getStringField(formData, "transactionDate"),
    description: getStringField(formData, "description"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali perubahan data pengeluaran kas.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { transactionId, categoryId, amount, transactionDate, description } =
    parsed.data
  const supabase = await createClient()

  const [{ data: existingRow }, { data: categoryRow }] = await Promise.all([
    supabase
      .from("cash_transactions")
      .select("id, payment_id, type")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", transactionId)
      .maybeSingle(),
    supabase
      .from("cash_categories")
      .select("id, type, is_active")
      .eq("tenant_id", tenant.tenantId)
      .eq("id", categoryId)
      .maybeSingle(),
  ])

  if (!existingRow) {
    return { error: "Transaksi kas tidak ditemukan pada RT ini." }
  }

  const existing = existingRow as {
    id: string
    payment_id: string | null
    type: string
  }

  if (existing.payment_id !== null) {
    return {
      error:
        "Transaksi kas yang berasal dari verifikasi pembayaran atau refund sistem bersifat permanen dan tidak dapat diubah.",
    }
  }

  if (existing.type !== "expense") {
    return {
      error: "Hanya pengeluaran kas manual yang dapat diubah melalui fitur ini.",
    }
  }

  const category = categoryRow as {
    id: string
    type: string
    is_active: boolean
  } | null

  if (!category || category.type !== "expense" || !category.is_active) {
    return {
      error: "Kategori pengeluaran tidak valid atau sudah dinonaktifkan.",
      fieldErrors: { categoryId: ["Pilih kategori pengeluaran kas yang aktif."] },
    }
  }

  const { error } = await supabase
    .from("cash_transactions")
    .update({
      category_id: categoryId,
      amount,
      transaction_date: transactionDate,
      description,
    })
    .eq("tenant_id", tenant.tenantId)
    .eq("id", transactionId)
    .is("payment_id", null)

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Anda tidak memiliki izin database untuk mengubah pengeluaran kas."
          : "Gagal memperbarui pengeluaran kas. Silakan coba lagi.",
    }
  }

  revalidateFinancePaths()
  redirect("/cash?updated=1")
}

