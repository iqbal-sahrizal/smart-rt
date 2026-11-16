/**
 * Development-only UI fixtures for Smart RT Dashboards.
 * These are static placeholder values for visual verification only —
 * NOT actual financial or resident data.
 */

export interface AdminKpiFixture {
  id: string
  label: string
  value: string
  helper: string
  trend: string
  trendVariant: "success" | "info" | "warning" | "secondary"
}

export interface FinancialMonthFixture {
  month: string
  income: number
  expense: number
}

export interface ActivityFixture {
  id: string
  title: string
  detail: string
  category: string
  time: string
}

export interface PaymentRecordFixture {
  id: string
  resident: string
  unit: string
  period: string
  amount: string
  method: string
  status: "Lunas" | "Menunggu" | "Terlambat"
}

export const ADMIN_KPI_FIXTURES: AdminKpiFixture[] = [
  {
    id: "kk",
    label: "Total Kepala Keluarga",
    value: "64",
    helper: "Terdaftar aktif (demo)",
    trend: "+2 bulan ini",
    trendVariant: "success",
  },
  {
    id: "warga",
    label: "Total Warga",
    value: "248",
    helper: "Jiwa tercatat (demo)",
    trend: "+4 jiwa",
    trendVariant: "info",
  },
  {
    id: "iuran",
    label: "Total Iuran Terkumpul",
    value: "Rp 8.850.000",
    helper: "Periode berjalan (demo)",
    trend: "92% target",
    trendVariant: "success",
  },
  {
    id: "saldo",
    label: "Total Saldo Kas",
    value: "Rp 18.450.000",
    helper: "Kas operasional (demo)",
    trend: "+6.4% YoY",
    trendVariant: "info",
  },
  {
    id: "pengaduan",
    label: "Pending Pengaduan",
    value: "3",
    helper: "Menunggu tindak lanjut",
    trend: "1 prioritas",
    trendVariant: "warning",
  },
]

export const ADMIN_FINANCIAL_CHART_FIXTURES: FinancialMonthFixture[] = [
  { month: "Jun", income: 7800000, expense: 4100000 },
  { month: "Jul", income: 8200000, expense: 5300000 },
  { month: "Agu", income: 8400000, expense: 4700000 },
  { month: "Sep", income: 8100000, expense: 3900000 },
  { month: "Okt", income: 8600000, expense: 4400000 },
  { month: "Nov", income: 8850000, expense: 3650000 },
]

export const ADMIN_RECENT_ACTIVITIES_FIXTURES: ActivityFixture[] = [
  {
    id: "act-1",
    title: "Verifikasi Iuran Bulanan",
    detail: "Unit Blok A-12 • Transfer Bank",
    category: "Keuangan",
    time: "10m lalu",
  },
  {
    id: "act-2",
    title: "Pengajuan Surat Domisili",
    detail: "Warga Demo #14 • Menunggu tanda tangan",
    category: "Surat",
    time: "1j lalu",
  },
  {
    id: "act-3",
    title: "Laporan Lampu Jalan Blok C",
    detail: "Status diubah menjadi Diproses",
    category: "Pengaduan",
    time: "3j lalu",
  },
  {
    id: "act-4",
    title: "Pembaruan Data Anggota KK",
    detail: "Unit Blok B-04 • Data demo",
    category: "Data Warga",
    time: "Kemarin",
  },
]

export const ADMIN_PAYMENT_RECORDS_FIXTURES: PaymentRecordFixture[] = [
  {
    id: "PAY-DEMO-01",
    resident: "Warga Demo A",
    unit: "Blok A-12",
    period: "Nov 2026",
    amount: "Rp 150.000",
    method: "QRIS",
    status: "Lunas",
  },
  {
    id: "PAY-DEMO-02",
    resident: "Warga Demo B",
    unit: "Blok B-03",
    period: "Nov 2026",
    amount: "Rp 150.000",
    method: "Transfer",
    status: "Lunas",
  },
  {
    id: "PAY-DEMO-03",
    resident: "Warga Demo C",
    unit: "Blok C-08",
    period: "Nov 2026",
    amount: "Rp 150.000",
    method: "Transfer",
    status: "Menunggu",
  },
  {
    id: "PAY-DEMO-04",
    resident: "Warga Demo D",
    unit: "Blok A-05",
    period: "Nov 2026",
    amount: "Rp 150.000",
    method: "Tunai",
    status: "Lunas",
  },
  {
    id: "PAY-DEMO-05",
    resident: "Warga Demo E",
    unit: "Blok D-02",
    period: "Okt 2026",
    amount: "Rp 150.000",
    method: "-",
    status: "Terlambat",
  },
]

export const RESIDENT_PROFILE_FIXTURE = {
  name: "Warga Demo",
  unit: "Blok B No. 08",
  rtRw: "RT 04 / RW 02",
  familyMembers: 4,
  membershipStatus: "Warga Aktif",
}

export const RESIDENT_DUES_FIXTURE = {
  period: "November 2026",
  amount: "Rp 150.000",
  dueDate: "20 November 2026",
  status: "Belum Dibayar" as const,
  breakdown: [
    { label: "Kebersihan & Sampah", amount: "Rp 60.000" },
    { label: "Keamanan Lingkungan", amount: "Rp 65.000" },
    { label: "Kas Sosial RT", amount: "Rp 25.000" },
  ],
}

export const RESIDENT_ANNOUNCEMENTS_FIXTURES = [
  {
    id: "ann-1",
    title: "Jadwal Kerja Bakti Akhir Pekan",
    summary:
      "Pembersihan saluran air dan taman blok dimulai pukul 07.00 WIB. (Contoh pengumuman)",
    category: "Kegiatan",
    date: "13 Nov 2026",
  },
  {
    id: "ann-2",
    title: "Pemeliharaan Penerangan Jalan Blok C",
    summary:
      "Teknisi akan melakukan pengecekan tiang lampu pada sore hari. (Contoh pengumuman)",
    category: "Info",
    date: "11 Nov 2026",
  },
]

export const RESIDENT_COMMUNITY_ACTIVITIES_FIXTURES = [
  {
    id: "comm-1",
    title: "Kerja Bakti Lingkungan",
    schedule: "Minggu, 15 Nov • 07:00 WIB",
    location: "Balai Warga RT 04",
    status: "Terjadwal",
  },
  {
    id: "comm-2",
    title: "Posyandu Bulanan",
    schedule: "Rabu, 18 Nov • 09:00 WIB",
    location: "Pos RT 04",
    status: "Terjadwal",
  },
  {
    id: "comm-3",
    title: "Rapat Koordinasi Warga",
    schedule: "Sabtu, 21 Nov • 19:30 WIB",
    location: "Aula Serbaguna",
    status: "Akan Datang",
  },
]

