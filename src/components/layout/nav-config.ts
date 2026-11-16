import type { LucideIcon } from "lucide-react"
import {
  BadgeCheckIcon,
  BellIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  MessageSquareWarningIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"

import type { RoleCode } from "@/lib/auth/types"

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  section: "main" | "system"
  badge?: string
  requiredRoles?: readonly RoleCode[]
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboardIcon,
    section: "main",
  },
  {
    title: "Data Warga",
    href: "/residents",
    icon: UsersIcon,
    section: "main",
  },
  {
    title: "Aktivasi Warga",
    href: "/resident-invitations",
    icon: UserPlusIcon,
    section: "main",
    requiredRoles: ["ketua_rt", "sekretaris"],
  },
  {
    title: "Konfigurasi Iuran",
    href: "/dues",
    icon: WalletIcon,
    section: "main",
  },
  {
    title: "Tagihan Warga",
    href: "/bills",
    icon: ReceiptIcon,
    section: "main",
  },
  {
    title: "Verifikasi Pembayaran",
    href: "/payments",
    icon: BadgeCheckIcon,
    section: "main",
    requiredRoles: ["bendahara"],
  },
  {
    title: "Kas & Pengeluaran",
    href: "/cash",
    icon: LandmarkIcon,
    section: "main",
  },
  {
    title: "Pengumuman",
    href: "/announcements",
    icon: MegaphoneIcon,
    section: "main",
  },
  {
    title: "Pengaduan",
    href: "/pengaduan",
    icon: MessageSquareWarningIcon,
    section: "main",
  },
  {
    title: "Surat Pengantar",
    href: "/surat",
    icon: FileTextIcon,
    section: "main",
    requiredRoles: ["ketua_rt", "sekretaris", "pengurus"],
  },
  {
    title: "Kegiatan",
    href: "/kegiatan",
    icon: CalendarDaysIcon,
    section: "main",
    requiredRoles: ["ketua_rt", "sekretaris", "pengurus"],
  },
  {
    title: "Jadwal Ronda",
    href: "/ronda",
    icon: ShieldCheckIcon,
    section: "main",
  },
  {
    title: "Notifikasi",
    href: "/notifications",
    icon: BellIcon,
    section: "system",
  },
  {
    title: "Pengaturan",
    href: "/pengaturan",
    icon: SettingsIcon,
    section: "system",
  },
]

export interface AdminNavSubItem {
  title: string
  href: string
  icon: LucideIcon
  requiredRoles?: readonly RoleCode[]
}

export type AdminNavEntry =
  | {
      kind: "link"
      id: string
      title: string
      href: string
      icon: LucideIcon
      requiredRoles?: readonly RoleCode[]
    }
  | {
      kind: "group"
      id: string
      label: string
      icon: LucideIcon
      items: AdminNavSubItem[]
    }

/**
 * Grouped admin sidebar structure mapped strictly to implemented routes in src/app/(admin)/.
 * Note: `/pengaturan` has no implemented page yet and is intentionally omitted from active links.
 */
export const ADMIN_NAV_GROUPS: AdminNavEntry[] = [
  {
    kind: "link",
    id: "dashboard",
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboardIcon,
  },
  {
    kind: "group",
    id: "data-warga",
    label: "Data Warga",
    icon: UsersIcon,
    items: [
      {
        title: "Data Warga",
        href: "/residents",
        icon: UsersIcon,
      },
      {
        title: "Aktivasi Warga",
        href: "/resident-invitations",
        icon: UserPlusIcon,
        requiredRoles: ["ketua_rt", "sekretaris"],
      },
    ],
  },
  {
    kind: "group",
    id: "keuangan",
    label: "Keuangan",
    icon: WalletIcon,
    items: [
      {
        title: "Konfigurasi Iuran",
        href: "/dues",
        icon: WalletIcon,
      },
      {
        title: "Tagihan Warga",
        href: "/bills",
        icon: ReceiptIcon,
      },
      {
        title: "Verifikasi Pembayaran",
        href: "/payments",
        icon: BadgeCheckIcon,
        requiredRoles: ["bendahara"],
      },
      {
        title: "Kas & Pengeluaran",
        href: "/cash",
        icon: LandmarkIcon,
      },
    ],
  },
  {
    kind: "group",
    id: "operasional-rt",
    label: "Operasional RT",
    icon: ShieldCheckIcon,
    items: [
      {
        title: "Jadwal Ronda",
        href: "/ronda",
        icon: ShieldCheckIcon,
      },
      {
        title: "Rekap Kehadiran Ronda",
        href: "/ronda/attendance",
        icon: ClipboardCheckIcon,
        requiredRoles: ["ketua_rt", "sekretaris"],
      },
      {
        title: "Kegiatan Warga",
        href: "/kegiatan",
        icon: CalendarDaysIcon,
        requiredRoles: ["ketua_rt", "sekretaris", "pengurus"],
      },
      {
        title: "Pengaduan",
        href: "/pengaduan",
        icon: MessageSquareWarningIcon,
      },
    ],
  },
  {
    kind: "group",
    id: "layanan-administrasi",
    label: "Layanan Administrasi",
    icon: FileTextIcon,
    items: [
      {
        title: "Surat Pengantar",
        href: "/surat",
        icon: FileTextIcon,
        requiredRoles: ["ketua_rt", "sekretaris", "pengurus"],
      },
      {
        title: "Jenis Surat",
        href: "/surat/jenis",
        icon: FileSpreadsheetIcon,
        requiredRoles: ["ketua_rt", "sekretaris", "pengurus"],
      },
    ],
  },
  {
    kind: "group",
    id: "informasi-komunikasi",
    label: "Informasi & Komunikasi",
    icon: MegaphoneIcon,
    items: [
      {
        title: "Pengumuman",
        href: "/announcements",
        icon: MegaphoneIcon,
      },
      {
        title: "Notifikasi",
        href: "/notifications",
        icon: BellIcon,
      },
    ],
  },
]

export function normalizeAdminPathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/)[0] || "/"
  if (withoutQuery === "/") return "/"
  const trimmed = withoutQuery.replace(/\/+$/, "")
  return trimmed || "/"
}

export function isAdminNavItemVisible(
  item: { requiredRoles?: readonly RoleCode[] },
  userRoles?: readonly RoleCode[]
): boolean {
  if (!item.requiredRoles || item.requiredRoles.length === 0) return true
  if (!userRoles) return true
  return item.requiredRoles.some((role) => userRoles.includes(role))
}

export function getVisibleAdminNavGroups(
  userRoles?: readonly RoleCode[]
): AdminNavEntry[] {
  const visible: AdminNavEntry[] = []
  for (const entry of ADMIN_NAV_GROUPS) {
    if (entry.kind === "link") {
      if (isAdminNavItemVisible(entry, userRoles)) {
        visible.push(entry)
      }
      continue
    }
    const items = entry.items.filter((sub) =>
      isAdminNavItemVisible(sub, userRoles)
    )
    if (items.length > 0) {
      visible.push({
        ...entry,
        items,
      })
    }
  }
  return visible
}

/**
 * Resolves the single most-specific active href among visible admin navigation entries.
 * Longest-prefix matching guarantees `/ronda/attendance` activates only Rekap Kehadiran Ronda
 * (not Jadwal Ronda) and `/surat/jenis` activates only Jenis Surat (not Surat Pengantar).
 */
export function resolveActiveAdminNavHref(
  pathname: string,
  entries: readonly AdminNavEntry[]
): string | null {
  const normalizedPath = normalizeAdminPathname(pathname)
  const candidateHrefs: string[] = []

  for (const entry of entries) {
    if (entry.kind === "link") {
      candidateHrefs.push(entry.href)
    } else {
      for (const sub of entry.items) {
        candidateHrefs.push(sub.href)
      }
    }
  }

  let bestHref: string | null = null
  for (const href of candidateHrefs) {
    const normalizedHref = normalizeAdminPathname(href)
    const matches =
      normalizedHref === "/"
        ? normalizedPath === "/"
        : normalizedPath === normalizedHref ||
          normalizedPath.startsWith(`${normalizedHref}/`)
    if (!matches) continue
    if (
      bestHref === null ||
      normalizedHref.length > normalizeAdminPathname(bestHref).length
    ) {
      bestHref = href
    }
  }

  return bestHref
}

export function findActiveAdminNavGroupId(
  pathname: string,
  userRoles?: readonly RoleCode[]
): string | null {
  const visible = getVisibleAdminNavGroups(userRoles)
  const activeHref = resolveActiveAdminNavHref(pathname, visible)
  if (!activeHref) return null

  for (const entry of visible) {
    if (entry.kind === "link") {
      if (entry.href === activeHref) return entry.id
    } else if (entry.items.some((sub) => sub.href === activeHref)) {
      return entry.id
    }
  }
  return null
}

export interface BreadcrumbSegment {
  label: string
  href?: string
}

export function getRouteTitle(rawPathname: string): string {
  const pathname = normalizeAdminPathname(rawPathname)
  if (pathname === "/residents/new") return "Tambah Warga"
  if (/^\/residents\/[^/]+\/edit$/.test(pathname)) return "Ubah Data Warga"
  if (/^\/residents\/[^/]+$/.test(pathname)) return "Detail Warga"
  if (pathname === "/resident-invitations") return "Aktivasi Akun Warga"
  if (pathname === "/announcements/new") return "Buat Pengumuman"
  if (/^\/announcements\/[^/]+\/edit$/.test(pathname)) return "Ubah Pengumuman"
  if (/^\/announcements\/[^/]+$/.test(pathname)) return "Detail Pengumuman"
  if (pathname === "/dues/new") return "Tambah Konfigurasi Iuran"
  if (/^\/dues\/[^/]+\/edit$/.test(pathname)) return "Ubah Konfigurasi Iuran"
  if (/^\/dues\/[^/]+$/.test(pathname)) return "Detail Konfigurasi Iuran"
  if (pathname === "/bills/new") return "Buat Tagihan"
  if (/^\/bills\/[^/]+$/.test(pathname)) return "Detail Tagihan"
  if (pathname === "/payments") return "Verifikasi Pembayaran"
  if (/^\/payments\/[^/]+$/.test(pathname)) return "Detail Pembayaran"
  if (pathname === "/cash") return "Kas & Pengeluaran"
  if (pathname === "/notifications") return "Pusat Notifikasi"
  if (pathname === "/pengaduan") return "Pengaduan Warga"
  if (/^\/pengaduan\/[^/]+$/.test(pathname)) return "Detail Pengaduan"
  if (pathname === "/surat") return "Surat Pengantar"
  if (pathname === "/surat/jenis") return "Jenis Surat"
  if (/^\/surat\/[^/]+$/.test(pathname)) return "Detail Permohonan Surat"
  if (pathname === "/kegiatan") return "Kegiatan Warga"
  if (pathname === "/kegiatan/new") return "Buat Kegiatan"
  if (/^\/kegiatan\/[^/]+\/edit$/.test(pathname)) return "Ubah Kegiatan"
  if (/^\/kegiatan\/[^/]+\/participants$/.test(pathname)) {
    return "Peserta & Presensi"
  }
  if (/^\/kegiatan\/[^/]+$/.test(pathname)) return "Detail Kegiatan"
  if (pathname === "/ronda") return "Jadwal Ronda"
  if (pathname === "/ronda/new") return "Tambah Jadwal Ronda"
  if (pathname === "/ronda/attendance") return "Rekap Kehadiran Ronda"
  if (/^\/ronda\/[^/]+\/edit$/.test(pathname)) return "Ubah Jadwal Ronda"
  if (/^\/ronda\/[^/]+$/.test(pathname)) return "Detail Jadwal Ronda"

  const exact = NAV_ITEMS.find((item) => item.href === pathname)
  if (exact) return exact.title

  const prefix = NAV_ITEMS.find(
    (item) => item.href !== "/" && pathname.startsWith(item.href)
  )
  return prefix?.title ?? "Dashboard"
}

export function getAdminBreadcrumbs(rawPathname: string): BreadcrumbSegment[] {
  const pathname = normalizeAdminPathname(rawPathname)
  if (pathname === "/residents") {
    return [{ label: "Data Warga" }]
  }
  if (pathname === "/residents/new") {
    return [
      { label: "Data Warga", href: "/residents" },
      { label: "Tambah Warga" },
    ]
  }
  const residentEditMatch = pathname.match(/^\/residents\/([^/]+)\/edit$/)
  if (residentEditMatch) {
    return [
      { label: "Data Warga", href: "/residents" },
      { label: "Detail Warga", href: `/residents/${residentEditMatch[1]}` },
      { label: "Ubah Data" },
    ]
  }
  if (/^\/residents\/[^/]+$/.test(pathname)) {
    return [
      { label: "Data Warga", href: "/residents" },
      { label: "Detail Warga" },
    ]
  }
  if (pathname === "/resident-invitations") {
    return [
      { label: "Data Warga", href: "/residents" },
      { label: "Aktivasi Akun Warga" },
    ]
  }

  if (pathname === "/announcements") {
    return [{ label: "Pengumuman" }]
  }
  if (pathname === "/announcements/new") {
    return [
      { label: "Pengumuman", href: "/announcements" },
      { label: "Buat Pengumuman" },
    ]
  }
  const announcementEditMatch = pathname.match(
    /^\/announcements\/([^/]+)\/edit$/
  )
  if (announcementEditMatch) {
    return [
      { label: "Pengumuman", href: "/announcements" },
      {
        label: "Detail Pengumuman",
        href: `/announcements/${announcementEditMatch[1]}`,
      },
      { label: "Ubah Pengumuman" },
    ]
  }
  if (/^\/announcements\/[^/]+$/.test(pathname)) {
    return [
      { label: "Pengumuman", href: "/announcements" },
      { label: "Detail Pengumuman" },
    ]
  }

  if (pathname === "/dues") {
    return [{ label: "Konfigurasi Iuran" }]
  }
  if (pathname === "/dues/new") {
    return [
      { label: "Konfigurasi Iuran", href: "/dues" },
      { label: "Tambah Iuran" },
    ]
  }
  const duesEditMatch = pathname.match(/^\/dues\/([^/]+)\/edit$/)
  if (duesEditMatch) {
    return [
      { label: "Konfigurasi Iuran", href: "/dues" },
      { label: "Detail Iuran", href: `/dues/${duesEditMatch[1]}` },
      { label: "Ubah Iuran" },
    ]
  }
  if (/^\/dues\/[^/]+$/.test(pathname)) {
    return [
      { label: "Konfigurasi Iuran", href: "/dues" },
      { label: "Detail Iuran" },
    ]
  }

  if (pathname === "/bills") {
    return [{ label: "Tagihan Warga" }]
  }
  if (pathname === "/bills/new") {
    return [
      { label: "Tagihan Warga", href: "/bills" },
      { label: "Buat Tagihan" },
    ]
  }
  if (/^\/bills\/[^/]+$/.test(pathname)) {
    return [
      { label: "Tagihan Warga", href: "/bills" },
      { label: "Detail Tagihan" },
    ]
  }

  if (pathname === "/payments") {
    return [{ label: "Verifikasi Pembayaran" }]
  }
  if (/^\/payments\/[^/]+$/.test(pathname)) {
    return [
      { label: "Verifikasi Pembayaran", href: "/payments" },
      { label: "Detail Pembayaran" },
    ]
  }
  if (pathname === "/cash") {
    return [{ label: "Kas & Pengeluaran" }]
  }
  if (pathname === "/notifications") {
    return [{ label: "Notifikasi" }]
  }
  if (pathname === "/pengaduan") {
    return [{ label: "Pengaduan Warga" }]
  }
  if (/^\/pengaduan\/[^/]+$/.test(pathname)) {
    return [
      { label: "Pengaduan Warga", href: "/pengaduan" },
      { label: "Detail Pengaduan" },
    ]
  }
  if (pathname === "/surat") {
    return [{ label: "Surat Pengantar" }]
  }
  if (pathname === "/surat/jenis") {
    return [
      { label: "Surat Pengantar", href: "/surat" },
      { label: "Jenis Surat" },
    ]
  }
  if (/^\/surat\/[^/]+$/.test(pathname)) {
    return [
      { label: "Surat Pengantar", href: "/surat" },
      { label: "Detail Permohonan" },
    ]
  }
  if (pathname === "/kegiatan") {
    return [{ label: "Kegiatan Warga" }]
  }
  if (pathname === "/kegiatan/new") {
    return [
      { label: "Kegiatan Warga", href: "/kegiatan" },
      { label: "Buat Kegiatan" },
    ]
  }
  const activityEditMatch = pathname.match(/^\/kegiatan\/([^/]+)\/edit$/)
  if (activityEditMatch) {
    return [
      { label: "Kegiatan Warga", href: "/kegiatan" },
      {
        label: "Detail Kegiatan",
        href: `/kegiatan/${activityEditMatch[1]}`,
      },
      { label: "Ubah Kegiatan" },
    ]
  }
  const activityParticipantsMatch = pathname.match(
    /^\/kegiatan\/([^/]+)\/participants$/
  )
  if (activityParticipantsMatch) {
    return [
      { label: "Kegiatan Warga", href: "/kegiatan" },
      {
        label: "Detail Kegiatan",
        href: `/kegiatan/${activityParticipantsMatch[1]}`,
      },
      { label: "Peserta & Presensi" },
    ]
  }
  if (/^\/kegiatan\/[^/]+$/.test(pathname)) {
    return [
      { label: "Kegiatan Warga", href: "/kegiatan" },
      { label: "Detail Kegiatan" },
    ]
  }
  if (pathname === "/ronda") {
    return [{ label: "Jadwal Ronda" }]
  }
  if (pathname === "/ronda/new") {
    return [
      { label: "Jadwal Ronda", href: "/ronda" },
      { label: "Tambah Jadwal" },
    ]
  }
  if (pathname === "/ronda/attendance") {
    return [
      { label: "Jadwal Ronda", href: "/ronda" },
      { label: "Rekap Kehadiran" },
    ]
  }
  const rondaEditMatch = pathname.match(/^\/ronda\/([^/]+)\/edit$/)
  if (rondaEditMatch) {
    return [
      { label: "Jadwal Ronda", href: "/ronda" },
      {
        label: "Detail Jadwal",
        href: `/ronda/${rondaEditMatch[1]}`,
      },
      { label: "Ubah Jadwal" },
    ]
  }
  if (/^\/ronda\/[^/]+$/.test(pathname)) {
    return [
      { label: "Jadwal Ronda", href: "/ronda" },
      { label: "Detail Jadwal" },
    ]
  }

  return [{ label: getRouteTitle(pathname) }]
}

