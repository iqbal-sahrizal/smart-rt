import type { LucideIcon } from "lucide-react"
import {
  ClipboardListIcon,
  HomeIcon,
  MegaphoneIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react"

export interface ResidentNavItem {
  label: string
  href: string
  icon: LucideIcon
}

export const RESIDENT_NAV_ITEMS: ResidentNavItem[] = [
  {
    label: "Beranda",
    href: "/resident",
    icon: HomeIcon,
  },
  {
    label: "Tagihan",
    href: "/resident/bills",
    icon: WalletIcon,
  },
  {
    label: "Pengumuman",
    href: "/resident/announcements",
    icon: MegaphoneIcon,
  },
  {
    label: "Layanan",
    href: "/resident/layanan",
    icon: ClipboardListIcon,
  },
  {
    label: "Profil",
    href: "/resident/profile",
    icon: UserIcon,
  },
]

export function isResidentRouteActive(pathname: string, href: string): boolean {
  if (href === "/resident") return pathname === "/resident"
  if (href === "/resident/profile") {
    return (
      pathname === "/resident/profile" ||
      pathname.startsWith("/resident/profile/") ||
      pathname === "/resident/household" ||
      pathname.startsWith("/resident/household/")
    )
  }
  if (href === "/resident/layanan") {
    return (
      pathname === "/resident/layanan" ||
      pathname.startsWith("/resident/layanan/") ||
      pathname === "/resident/ronda" ||
      pathname.startsWith("/resident/ronda/") ||
      pathname === "/resident/complaints" ||
      pathname.startsWith("/resident/complaints/") ||
      pathname === "/resident/letters" ||
      pathname.startsWith("/resident/letters/") ||
      pathname === "/resident/activities" ||
      pathname.startsWith("/resident/activities/")
    )
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

