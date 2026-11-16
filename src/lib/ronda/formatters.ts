import type {
  RondaAttendanceAdminRecord,
  RondaAttendanceStatus,
  RondaResidentCandidate,
  RondaScheduleListItem,
} from "./types"

const DATE_LONG_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jakarta",
})

const DATE_SHORT_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
})

const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jakarta",
})

const DATETIME_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
})

function parseIsoDateUtcNoon(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const [y, m, d] = isoDate.split("-").map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d, 5, 0, 0))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatRondaDateLong(isoDate: string): string {
  const d = parseIsoDateUtcNoon(isoDate)
  return d ? DATE_LONG_FORMATTER.format(d) : isoDate
}

export function formatRondaDateShort(isoDate: string): string {
  const d = parseIsoDateUtcNoon(isoDate)
  return d ? DATE_SHORT_FORMATTER.format(d) : isoDate
}

export function formatRondaDateTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "-"
  const d = new Date(isoTimestamp)
  return Number.isNaN(d.getTime()) ? isoTimestamp : `${DATETIME_FORMATTER.format(d)} WIB`
}

export function formatRondaTimeRange(
  startTime: string | null,
  endTime: string | null
): { label: string; isOvernight: boolean } {
  const start = startTime ? startTime.slice(0, 5) : null
  const end = endTime ? endTime.slice(0, 5) : null

  if (!start && !end) {
    return { label: "Waktu fleksibel", isOvernight: false }
  }
  if (start && !end) {
    return { label: `Mulai ${start} WIB`, isOvernight: false }
  }
  if (!start && end) {
    return { label: `Hingga ${end} WIB`, isOvernight: false }
  }

  const isOvernight = Boolean(start && end && end < start)
  return {
    label: isOvernight
      ? `${start} – ${end} WIB (+1 hari)`
      : `${start} – ${end} WIB`,
    isOvernight,
  }
}

export function isValidMonthKey(monthKey: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return false
  const [, month] = monthKey.split("-").map(Number)
  return month >= 1 && month <= 12
}

export function getMonthKeyFromDate(isoDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate.slice(0, 7) : "2026-01"
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 15))
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

export function formatMonthTitle(monthKey: string): string {
  const d = parseIsoDateUtcNoon(`${monthKey}-15`)
  return d ? MONTH_YEAR_FORMATTER.format(d) : monthKey
}

export function getMonthDateRange(monthKey: string): {
  fromDate: string
  toDate: string
} {
  const [y, m] = monthKey.split("-").map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, "0")
  return {
    fromDate: `${y}-${mm}-01`,
    toDate: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  }
}

export interface CalendarCell {
  isoDate: string
  dayNumber: number
  inCurrentMonth: boolean
  schedule?: RondaScheduleListItem
}

/**
 * Membangun grid kalender 7 kolom (Senin s.d. Minggu) untuk satu bulan penuh.
 */
export function buildRondaMonthCalendar(
  monthKey: string,
  schedules: readonly RondaScheduleListItem[]
): CalendarCell[] {
  const [y, m] = monthKey.split("-").map(Number)
  const byDate = new Map<string, RondaScheduleListItem>()
  for (const s of schedules) {
    byDate.set(s.scheduleDate, s)
  }

  const firstDayUtc = new Date(Date.UTC(y, m - 1, 1))
  // Convert Sunday=0..Saturday=6 into Monday=0..Sunday=6
  const mondayOffset = (firstDayUtc.getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const totalCells = Math.ceil((mondayOffset + daysInMonth) / 7) * 7

  const cells: CalendarCell[] = []
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(Date.UTC(y, m - 1, 1 - mondayOffset + i))
    const cy = cellDate.getUTCFullYear()
    const cm = String(cellDate.getUTCMonth() + 1).padStart(2, "0")
    const cd = String(cellDate.getUTCDate()).padStart(2, "0")
    const isoDate = `${cy}-${cm}-${cd}`
    cells.push({
      isoDate,
      dayNumber: cellDate.getUTCDate(),
      inCurrentMonth: cy === y && cellDate.getUTCMonth() + 1 === m,
      schedule: byDate.get(isoDate),
    })
  }

  return cells
}

export interface RondaAttendanceSummaryStats {
  total: number
  present: number
  absent: number
  excused: number
  unrecorded: number
  attendanceRatePercent: number
}

export function summarizeRondaAttendance(
  records: ReadonlyArray<{ attendanceStatus: RondaAttendanceStatus | null }>
): RondaAttendanceSummaryStats {
  let present = 0
  let absent = 0
  let excused = 0
  let unrecorded = 0

  for (const rec of records) {
    if (rec.attendanceStatus === "present") present += 1
    else if (rec.attendanceStatus === "absent") absent += 1
    else if (rec.attendanceStatus === "excused") excused += 1
    else unrecorded += 1
  }

  const total = records.length
  const recorded = present + absent + excused
  const attendanceRatePercent =
    recorded > 0 ? Math.round((present / recorded) * 100) : 0

  return {
    total,
    present,
    absent,
    excused,
    unrecorded,
    attendanceRatePercent,
  }
}

export interface SelectedOfficerItem {
  residentId: string
  fullName: string
  householdLabel: string | null
  attendanceStatus?: RondaAttendanceStatus | null
}

/**
 * Menambahkan warga ke daftar petugas terpilih tanpa duplikasi.
 */
export function addResidentToRoster(
  current: readonly SelectedOfficerItem[],
  candidate: RondaResidentCandidate
): SelectedOfficerItem[] {
  if (current.some((item) => item.residentId === candidate.id)) {
    return [...current]
  }
  return [
    ...current,
    {
      residentId: candidate.id,
      fullName: candidate.fullName,
      householdLabel: candidate.householdLabel,
    },
  ]
}

/**
 * Menghapus petugas dari daftar terpilih.
 */
export function removeResidentFromRoster(
  current: readonly SelectedOfficerItem[],
  residentId: string
): SelectedOfficerItem[] {
  return current.filter((item) => item.residentId !== residentId)
}

/**
 * Mengelompokkan rekap kehadiran admin per tanggal sesi.
 */
export function groupAttendanceBySchedule(
  records: readonly RondaAttendanceAdminRecord[]
): Array<{
  scheduleId: string
  scheduleDate: string
  records: RondaAttendanceAdminRecord[]
}> {
  const groups = new Map<
    string,
    {
      scheduleId: string
      scheduleDate: string
      records: RondaAttendanceAdminRecord[]
    }
  >()

  for (const record of records) {
    const existing = groups.get(record.scheduleId)
    if (existing) {
      existing.records.push(record)
    } else {
      groups.set(record.scheduleId, {
        scheduleId: record.scheduleId,
        scheduleDate: record.scheduleDate,
        records: [record],
      })
    }
  }

  return Array.from(groups.values())
}
