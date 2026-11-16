import { z } from "zod"

import { INDONESIAN_MONTH_NAMES } from "@/lib/finance/types"
import type {
  AnalyticsFilterInput,
  AnalyticsPeriodMode,
  ResolvedAnalyticsPeriod,
} from "@/lib/analytics/types"

export const isoDateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/

export const analyticsPeriodModeSchema = z.enum([
  "last_6_months",
  "monthly",
  "yearly",
  "custom",
])

export const analyticsActivityCategorySchema = z.enum([
  "all",
  "payment",
  "complaint",
  "letter",
  "announcement",
])

export function getJakartaCalendarParts(now: Date = new Date()): {
  year: number
  month: number
  day: number
  isoDate: string
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)

  const year = Number(parts.find((p) => p.type === "year")?.value ?? "2026")
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1")
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1")
  return {
    year,
    month,
    day,
    isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  }
}

export function getLastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function formatIsoDateParts(
  year: number,
  month: number,
  day: number
): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function addMonths(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
  }
}

export function getDefaultAnalyticsFilter(
  now: Date = new Date()
): AnalyticsFilterInput {
  const jakarta = getJakartaCalendarParts(now)
  const startMonth = addMonths(jakarta.year, jakarta.month, -5)
  const endDay = getLastDayOfMonth(jakarta.year, jakarta.month)
  return {
    periodMode: "last_6_months",
    year: jakarta.year,
    month: jakarta.month,
    startDate: formatIsoDateParts(startMonth.year, startMonth.month, 1),
    endDate: formatIsoDateParts(jakarta.year, jakarta.month, endDay),
  }
}

const rawQuerySchema = z.object({
  periodMode: analyticsPeriodModeSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  startDate: z.string().trim().regex(isoDateOnlyRegex).optional(),
  endDate: z.string().trim().regex(isoDateOnlyRegex).optional(),
  activityCategory: analyticsActivityCategorySchema.optional(),
  activityPage: z.coerce.number().int().min(1).max(100).optional(),
  activityPageSize: z.coerce.number().int().min(3).max(20).optional(),
})

export type ParsedAnalyticsRequest = {
  filter: ResolvedAnalyticsPeriod
  activityCategory: z.infer<typeof analyticsActivityCategorySchema>
  activityPage: number
  activityPageSize: number
}

function isValidCalendarDate(isoDate: string): boolean {
  if (!isoDateOnlyRegex.test(isoDate)) return false
  const [yStr, mStr, dStr] = isoDate.split("-")
  const y = Number(yStr)
  const m = Number(mStr)
  const d = Number(dStr)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  )
}

function daysBetweenIsoDates(startIso: string, endIso: string): number {
  const startMs = Date.parse(`${startIso}T00:00:00Z`)
  const endMs = Date.parse(`${endIso}T00:00:00Z`)
  return Math.round((endMs - startMs) / 86_400_000)
}

function formatShortPeriodLabel(startIso: string, endIso: string): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${iso}T00:00:00+07:00`))
  return `${fmt(startIso)} – ${fmt(endIso)}`
}

export function resolveAnalyticsPeriod(
  input: Partial<AnalyticsFilterInput>,
  now: Date = new Date()
):
  | { ok: true; period: ResolvedAnalyticsPeriod }
  | { ok: false; error: string } {
  const jakarta = getJakartaCalendarParts(now)
  const mode: AnalyticsPeriodMode = input.periodMode ?? "last_6_months"
  const year =
    input.year && input.year >= 2000 && input.year <= 2100
      ? input.year
      : jakarta.year
  const month =
    input.month && input.month >= 1 && input.month <= 12
      ? input.month
      : jakarta.month

  if (mode === "last_6_months") {
    const startYm = addMonths(jakarta.year, jakarta.month, -5)
    const startDate = formatIsoDateParts(startYm.year, startYm.month, 1)
    const endDate = formatIsoDateParts(
      jakarta.year,
      jakarta.month,
      getLastDayOfMonth(jakarta.year, jakarta.month)
    )
    return {
      ok: true,
      period: {
        periodMode: "last_6_months",
        year: jakarta.year,
        month: jakarta.month,
        startDate,
        endDate,
        label: `6 Bulan Terakhir (${INDONESIAN_MONTH_NAMES[startYm.month - 1]} ${startYm.year} – ${INDONESIAN_MONTH_NAMES[jakarta.month - 1]} ${jakarta.year})`,
        granularity: "month",
      },
    }
  }

  if (mode === "monthly") {
    const startDate = formatIsoDateParts(year, month, 1)
    const endDate = formatIsoDateParts(year, month, getLastDayOfMonth(year, month))
    return {
      ok: true,
      period: {
        periodMode: "monthly",
        year,
        month,
        startDate,
        endDate,
        label: `Bulanan (${INDONESIAN_MONTH_NAMES[month - 1]} ${year})`,
        granularity: "week",
      },
    }
  }

  if (mode === "yearly") {
    return {
      ok: true,
      period: {
        periodMode: "yearly",
        year,
        month,
        startDate: formatIsoDateParts(year, 1, 1),
        endDate: formatIsoDateParts(year, 12, 31),
        label: `Tahunan (Tahun ${year})`,
        granularity: "month",
      },
    }
  }

  // Custom date range
  const startDate = input.startDate
  const endDate = input.endDate
  if (!startDate || !endDate) {
    return {
      ok: false,
      error: "Rentang tanggal harus menyertakan tanggal mulai dan tanggal akhir.",
    }
  }
  if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) {
    return {
      ok: false,
      error: "Format tanggal tidak valid. Gunakan tanggal kalender yang benar.",
    }
  }
  if (startDate > endDate) {
    return {
      ok: false,
      error: "Tanggal mulai tidak boleh melebihi tanggal akhir.",
    }
  }
  const spanDays = daysBetweenIsoDates(startDate, endDate)
  if (spanDays > 731) {
    return {
      ok: false,
      error: "Rentang tanggal maksimal adalah 24 bulan (731 hari).",
    }
  }

  const parsedStartYear = Number(startDate.slice(0, 4))
  const parsedStartMonth = Number(startDate.slice(5, 7))

  return {
    ok: true,
    period: {
      periodMode: "custom",
      year: parsedStartYear,
      month: parsedStartMonth,
      startDate,
      endDate,
      label: formatShortPeriodLabel(startDate, endDate),
      granularity: spanDays <= 45 ? "week" : "month",
    },
  }
}

export function parseAnalyticsSearchParams(
  raw: Record<string, string | string[] | undefined>,
  now: Date = new Date()
):
  | { ok: true; value: ParsedAnalyticsRequest }
  | { ok: false; error: string } {
  const flat: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value
  }

  const parsed = rawQuerySchema.safeParse(flat)
  if (!parsed.success) {
    return {
      ok: false,
      error: "Parameter filter laporan analitik tidak valid.",
    }
  }

  const periodResult = resolveAnalyticsPeriod(
    {
      periodMode: parsed.data.periodMode,
      year: parsed.data.year,
      month: parsed.data.month,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    },
    now
  )

  if (!periodResult.ok) {
    return periodResult
  }

  return {
    ok: true,
    value: {
      filter: periodResult.period,
      activityCategory: parsed.data.activityCategory ?? "all",
      activityPage: parsed.data.activityPage ?? 1,
      activityPageSize: parsed.data.activityPageSize ?? 6,
    },
  }
}

/**
 * Sanitizes CSV cells against spreadsheet formula injection (=, +, -, @, tab, CR)
 * and escapes quotes/commas properly per RFC 4180.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""'
  let str = String(value)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`
  }
  const escaped = str.replace(/"/g, '""')
  return `"${escaped}"`
}

