import { Suspense } from "react"
import Link from "next/link"
import {
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  MegaphoneIcon,
  MessageSquareWarningIcon,
  ShieldCheckIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"

import { ResidentContainer } from "@/components/resident/resident-container"
import { ResidentRondaSkeleton } from "@/components/ronda/ronda-skeletons"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireResidentContext } from "@/lib/auth/guards"

const RESIDENT_SERVICES = [
  {
    title: "Permohonan Surat Pengantar",
    description:
      "Ajukan surat pengantar RT, unggah dokumen persyaratan, pantau proses review, dan unduh PDF surat terbit.",
    href: "/resident/letters",
    icon: FileTextIcon,
    featured: true,
  },
  {
    title: "Pengaduan Warga",
    description:
      "Laporkan keluhan fasilitas, kebersihan, atau keamanan RT beserta foto dan pantau perkembangannya.",
    href: "/resident/complaints",
    icon: MessageSquareWarningIcon,
    featured: false,
  },
  {
    title: "Kegiatan Warga",
    description:
      "Lihat agenda kegiatan RT, cek kuota peserta, daftar mandiri, dan pantau riwayat keikutsertaan Anda.",
    href: "/resident/activities",
    icon: CalendarDaysIcon,
    featured: false,
  },
  {
    title: "Jadwal Ronda Malam",
    description:
      "Cek jadwal ronda RT, daftar petugas yang berjaga, dan status kehadiran pribadi Anda.",
    href: "/resident/ronda",
    icon: ShieldCheckIcon,
    featured: false,
  },
  {
    title: "Tagihan & Pembayaran Iuran",
    description:
      "Lihat daftar tagihan bulanan, unggah bukti transfer, dan pantau status verifikasi.",
    href: "/resident/bills",
    icon: WalletIcon,
    featured: false,
  },
  {
    title: "Pengumuman Resmi RT",
    description:
      "Baca pengumuman dan informasi terbaru dari pengurus RT setempat.",
    href: "/resident/announcements",
    icon: MegaphoneIcon,
    featured: false,
  },
  {
    title: "Kartu Keluarga & Anggota",
    description:
      "Periksa data rumah tangga dan daftar anggota keluarga terdaftar.",
    href: "/resident/household",
    icon: UsersIcon,
    featured: false,
  },
]

async function ResidentLayananContent() {
  const { tenant } = await requireResidentContext()

  return (
    <ResidentContainer className="flex flex-col gap-[var(--space-5)]">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Layanan Warga
        </h1>
        <p className="text-sm text-muted-foreground">
          Akses cepat layanan dan informasi warga di {tenant.tenantName}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {RESIDENT_SERVICES.map((service) => {
          const Icon = service.icon
          return (
            <Link key={service.href} href={service.href} className="group">
              <Card
                className={
                  service.featured
                    ? "h-full border-primary/40 bg-primary-subtle/20 transition-colors group-hover:border-primary"
                    : "h-full transition-colors group-hover:border-primary/40"
                }
              >
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="space-y-1">
                      <CardTitle className="text-base">{service.title}</CardTitle>
                      <CardDescription className="text-xs leading-relaxed">
                        {service.description}
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </CardHeader>
                <CardContent className="pt-0">
                  <span className="text-xs font-medium text-primary">
                    Buka layanan
                  </span>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </ResidentContainer>
  )
}

export default function ResidentLayananPage() {
  return (
    <Suspense fallback={<ResidentRondaSkeleton />}>
      <ResidentLayananContent />
    </Suspense>
  )
}

