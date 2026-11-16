import { z } from "zod"

import { isValidUuid } from "@/lib/residents/schemas"

export const DUES_BILLING_CYCLE_VALUES = [
  "monthly",
  "yearly",
  "one_time",
] as const

export const DUES_TARGET_SCOPE_VALUES = ["household", "resident"] as const

export const EDITABLE_BILL_STATUS_VALUES = [
  "unpaid",
  "overdue",
  "cancelled",
] as const

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

function parseCalendarDate(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false
  const [y, m, d] = value.split("-").map((n) => Number.parseInt(n, 10))
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return false
  }
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

const amountSchema = z
  .string()
  .trim()
  .min(1, "Nominal wajib diisi.")
  .refine((val) => /^\d+(?:[.,]\d{1,2})?$/.test(val), {
    message: "Nominal harus berupa angka yang valid (maksimal 2 angka desimal).",
  })
  .transform((val) => Number.parseFloat(val.replace(",", ".")))
  .refine((num) => Number.isFinite(num) && num >= 0 && num <= 999999999999, {
    message: "Nominal tidak boleh negatif dan maksimal Rp 999.999.999.999.",
  })

const periodYearSchema = z.coerce
  .number({ message: "Tahun periode harus berupa angka." })
  .int("Tahun periode harus bilangan bulat.")
  .min(2000, "Tahun periode minimal 2000.")
  .max(2100, "Tahun periode maksimal 2100.")

const periodMonthSchema = z.coerce
  .number({ message: "Bulan periode harus berupa angka." })
  .int("Bulan periode harus bilangan bulat.")
  .min(1, "Bulan periode harus antara 1 dan 12.")
  .max(12, "Bulan periode harus antara 1 dan 12.")

const dueDateSchema = z
  .string()
  .trim()
  .regex(DATE_REGEX, "Tanggal jatuh tempo wajib diisi dengan format YYYY-MM-DD.")
  .refine(parseCalendarDate, "Tanggal jatuh tempo tidak valid.")

const baseDuesObject = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Nama iuran minimal 3 karakter.")
    .max(120, "Nama iuran maksimal 120 karakter."),
  description: z
    .string()
    .trim()
    .max(1000, "Deskripsi iuran maksimal 1.000 karakter.")
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  amount: amountSchema,
  billingCycle: z.enum(DUES_BILLING_CYCLE_VALUES, {
    message: "Pilih siklus penagihan yang valid.",
  }),
  targetScope: z.enum(DUES_TARGET_SCOPE_VALUES, {
    message: "Pilih cakupan target penagihan yang valid.",
  }),
  isActive: z
    .union([z.literal("true"), z.literal("false"), z.literal("on")])
    .optional()
    .transform((val) => val === "true" || val === "on"),
})

export const createDuesSchema = baseDuesObject

export const updateDuesSchema = baseDuesObject.extend({
  dueId: z.string().trim().regex(UUID_REGEX, "ID konfigurasi iuran tidak valid."),
})

export const deleteDuesSchema = z.object({
  dueId: z.string().trim().regex(UUID_REGEX, "ID konfigurasi iuran tidak valid."),
})

export const createBillSchema = z.object({
  dueId: z.string().trim().regex(UUID_REGEX, "Pilih jenis iuran yang valid."),
  targetId: z.string().trim().regex(UUID_REGEX, "Pilih target tagihan yang valid."),
  periodYear: periodYearSchema,
  periodMonth: periodMonthSchema,
  amount: amountSchema,
  dueDate: dueDateSchema,
})

function uniqueValidUuids(values: string[]): string[] {
  const unique = new Set<string>()
  for (const v of values) {
    const t = v.trim()
    if (isValidUuid(t)) unique.add(t)
  }
  return Array.from(unique)
}

export const generateBillsSchema = z
  .object({
    dueId: z.string().trim().regex(UUID_REGEX, "Pilih jenis iuran yang valid."),
    targetMode: z.enum(["all_active", "selected"], {
      message: "Pilih mode pemilihan target tagihan.",
    }),
    selectedTargetIds: z
      .array(z.string())
      .default([])
      .transform(uniqueValidUuids),
    periodYear: periodYearSchema,
    periodMonth: periodMonthSchema,
    amount: amountSchema,
    dueDate: dueDateSchema,
  })
  .superRefine((data, ctx) => {
    if (
      data.targetMode === "selected" &&
      data.selectedTargetIds.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedTargetIds"],
        message: "Pilih minimal satu target untuk pembuatan tagihan massal.",
      })
    }
  })

export const updateBillSchema = z.object({
  billId: z.string().trim().regex(UUID_REGEX, "ID tagihan tidak valid."),
  amount: amountSchema,
  dueDate: dueDateSchema,
  status: z.enum(EDITABLE_BILL_STATUS_VALUES, {
    message: "Status tagihan hanya dapat diubah menjadi Belum Dibayar, Jatuh Tempo, atau Dibatalkan.",
  }),
})

export const RESIDENT_PAYMENT_METHOD_VALUES = [
  "transfer",
  "qris",
  "cash",
] as const

export const cancelBillSchema = z.object({
  billId: z.string().trim().regex(UUID_REGEX, "ID tagihan tidak valid."),
})

export const submitResidentPaymentSchema = z.object({
  billId: z.string().trim().regex(UUID_REGEX, "ID tagihan tidak valid."),
  paymentMethod: z.enum(RESIDENT_PAYMENT_METHOD_VALUES, {
    message: "Pilih metode pembayaran (Transfer Bank, QRIS, atau Tunai).",
  }),
  amount: amountSchema.refine((num) => num > 0, {
    message: "Nominal pembayaran harus lebih dari Rp 0.",
  }),
  notes: z
    .string()
    .trim()
    .max(500, "Catatan pembayaran maksimal 500 karakter.")
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  idempotencyNonce: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  recoveryPaymentId: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null))
    .refine((val) => val === null || UUID_REGEX.test(val), {
      message: "ID pembayaran pemulihan tidak valid.",
    }),
})

export const retryPaymentProofSchema = z.object({
  billId: z.string().trim().regex(UUID_REGEX, "ID tagihan tidak valid."),
  paymentId: z.string().trim().regex(UUID_REGEX, "ID pembayaran tidak valid."),
})

export const verifyPaymentSchema = z.object({
  paymentId: z.string().trim().regex(UUID_REGEX, "ID pembayaran tidak valid."),
  cashCategoryId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "Pilih kategori kas masuk yang valid."),
  notes: z
    .string()
    .trim()
    .max(500, "Catatan verifikasi maksimal 500 karakter.")
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
})

export const rejectPaymentSchema = z.object({
  paymentId: z.string().trim().regex(UUID_REGEX, "ID pembayaran tidak valid."),
  reason: z
    .string()
    .trim()
    .min(3, "Alasan penolakan wajib diisi minimal 3 karakter.")
    .max(500, "Alasan penolakan maksimal 500 karakter."),
})

export const refundPaymentSchema = z.object({
  parentPaymentId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "ID pembayaran induk tidak valid."),
  amount: amountSchema.refine((num) => num > 0, {
    message: "Nominal pengembalian dana harus lebih dari Rp 0.",
  }),
  cashCategoryId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "Pilih kategori pengeluaran kas yang valid."),
  reason: z
    .string()
    .trim()
    .min(3, "Alasan pengembalian dana wajib diisi minimal 3 karakter.")
    .max(500, "Alasan pengembalian dana maksimal 500 karakter."),
})

export const createCashCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama kategori kas minimal 2 karakter.")
    .max(80, "Nama kategori kas maksimal 80 karakter."),
  type: z.enum(["income", "expense"], {
    message: "Pilih tipe kategori kas yang valid (Kas Masuk atau Pengeluaran).",
  }).default("income"),
})

export const toggleCashCategorySchema = z.object({
  categoryId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "ID kategori kas tidak valid."),
  isActive: z
    .enum(["true", "false"])
    .transform((val) => val === "true"),
})

const transactionDateSchema = z
  .string()
  .trim()
  .regex(DATE_REGEX, "Tanggal transaksi wajib diisi dengan format YYYY-MM-DD.")
  .refine(parseCalendarDate, "Tanggal transaksi tidak valid.")

export const createCashExpenseSchema = z.object({
  categoryId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "Pilih kategori pengeluaran kas yang valid."),
  amount: amountSchema.refine((num) => num > 0, {
    message: "Nominal pengeluaran harus lebih dari Rp 0.",
  }),
  transactionDate: transactionDateSchema,
  description: z
    .string()
    .trim()
    .min(3, "Keterangan pengeluaran wajib diisi minimal 3 karakter.")
    .max(500, "Keterangan pengeluaran maksimal 500 karakter."),
})

export const updateCashExpenseSchema = createCashExpenseSchema.extend({
  transactionId: z
    .string()
    .trim()
    .regex(UUID_REGEX, "ID transaksi kas tidak valid."),
})

