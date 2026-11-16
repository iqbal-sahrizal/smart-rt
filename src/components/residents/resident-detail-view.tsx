import Link from "next/link"
import {
  ArrowLeftIcon,
  CarIcon,
  CheckCircle2Icon,
  FileTextIcon,
  HomeIcon,
  LockIcon,
  PencilIcon,
  ShieldAlertIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"

import { ResidentInvitationPanel } from "@/components/invitations/resident-invitation-panel"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { HouseholdEditDialog } from "@/components/residents/household-edit-dialog"
import { ResidentArchiveDialog } from "@/components/residents/resident-archive-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ResidentAccountLinkSummary } from "@/lib/invitations/types"
import type { AdminResidentDetailResult } from "@/lib/residents/queries"
import {
  DOCUMENT_TYPE_LABELS,
  FAMILY_ROLE_LABELS,
  GENDER_LABELS,
  HOUSEHOLD_STATUS_LABELS,
  RESIDENCY_STATUS_LABELS,
  STAY_STATUS_LABELS,
  VEHICLE_TYPE_LABELS,
  getHouseholdStatusBadgeVariant,
  getResidencyStatusBadgeVariant,
} from "@/lib/residents/types"

function formatIndonesianDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return isoDate
  return parsed.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ResidentDetailViewProps {
  detail: AdminResidentDetailResult
  linkSummary: ResidentAccountLinkSummary
  canManage: boolean
  notice?: "created" | "updated" | "readonly" | null
}

export function ResidentDetailView({
  detail,
  linkSummary,
  canManage,
  notice = null,
}: ResidentDetailViewProps) {
  const {
    resident,
    household,
    householdMembers,
    vehicles,
    sensitiveAccessAllowed,
    privateData,
    documents,
  } = detail

  const headResident = household
    ? householdMembers.find((m) => m.id === household.headResidentId) ?? null
    : null
  const isCurrentResidentHead = household?.headResidentId === resident.id

  return (
    <PageContainer>
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/residents" />}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Kembali ke Direktori Warga
          </Button>
        </div>

        <PageHeader
          title={resident.fullName}
          description={`${GENDER_LABELS[resident.gender]} • ${FAMILY_ROLE_LABELS[resident.familyRole]}${
            isCurrentResidentHead ? " • Kepala Keluarga" : ""
          }`}
          actions={
            canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={`/residents/${resident.id}/edit`} />}
                >
                  <PencilIcon data-icon="inline-start" />
                  Ubah Data Warga
                </Button>
                <ResidentArchiveDialog
                  residentId={resident.id}
                  residentName={resident.fullName}
                />
              </div>
            ) : (
              <Badge variant="outline" size="lg">
                Mode Lihat Saja
              </Badge>
            )
          }
        />
      </div>

      {notice === "created" && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-sm text-success-text"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Data warga baru berhasil disimpan.</span>
        </div>
      )}

      {notice === "updated" && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-sm text-success-text"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Perubahan data warga berhasil disimpan.</span>
        </div>
      )}

      {notice === "readonly" && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-warning-text"
        >
          <ShieldAlertIcon className="size-4 shrink-0" />
          <span>
            Hanya Ketua RT atau Sekretaris yang dapat mengubah data warga.
          </span>
        </div>
      )}

      <div className="grid gap-[var(--space-6)] lg:grid-cols-2">
        {/* Card 1: Basic Resident Profile */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserIcon className="size-4 text-primary" />
              <CardTitle className="text-base">Profil Warga</CardTitle>
            </div>
            <CardAction>
              <Badge
                variant={getResidencyStatusBadgeVariant(
                  resident.residencyStatus
                )}
              >
                {RESIDENCY_STATUS_LABELS[resident.residencyStatus]}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Nama Lengkap</p>
              <p className="mt-0.5 font-medium text-foreground">
                {resident.fullName}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Jenis Kelamin</p>
              <p className="mt-0.5 font-medium text-foreground">
                {GENDER_LABELS[resident.gender]}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Peran Keluarga</p>
              <p className="mt-0.5 font-medium text-foreground">
                {FAMILY_ROLE_LABELS[resident.familyRole]}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status Tinggal</p>
              <p className="mt-0.5 font-medium text-foreground">
                {STAY_STATUS_LABELS[resident.stayStatus]}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Nomor Telepon</p>
              <p className="mt-0.5 font-medium text-foreground">
                {resident.phone ?? "Belum dicatat"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Sensitive Private Data (Role-Gated) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <LockIcon className="size-4 text-primary" />
              <CardTitle className="text-base">
                Data Kependudukan Terproteksi
              </CardTitle>
            </div>
            <CardDescription>
              Akses terbatas hanya untuk Ketua RT dan Sekretaris sesuai
              kebijakan RLS database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!sensitiveAccessAllowed ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  Data pribadi sensitif (NIK, tempat dan tanggal lahir, serta
                  dokumen kependudukan) hanya dapat dilihat oleh peran{" "}
                  <strong className="text-foreground">Ketua RT</strong> dan{" "}
                  <strong className="text-foreground">Sekretaris</strong>.
                </span>
              </div>
            ) : !privateData ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Data NIK dan kelahiran belum dilengkapi.{" "}
                {canManage && (
                  <Link
                    href={`/residents/${resident.id}/edit`}
                    className="font-medium text-primary hover:underline"
                  >
                    Lengkapi sekarang
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">
                    Nomor Induk Kependudukan (NIK)
                  </p>
                  <p className="mt-0.5 font-mono font-medium text-foreground">
                    {privateData.nik}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tempat Lahir</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {privateData.birthPlace}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tanggal Lahir</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {formatIndonesianDate(privateData.birthDate)}
                  </p>
                </div>
                {privateData.extraNotes && (
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">
                      Catatan Kependudukan
                    </p>
                    <p className="mt-0.5 text-foreground">
                      {privateData.extraNotes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Account Activation & Invitation Panel */}
      <ResidentInvitationPanel
        residentId={resident.id}
        residentName={resident.fullName}
        residencyStatus={resident.residencyStatus}
        canManage={canManage}
        linkSummary={linkSummary}
      />

      {/* Card 3: Household Info & Members */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <HomeIcon className="size-4 text-primary" />
            <CardTitle className="text-base">
              Informasi Kartu Keluarga & Anggota
            </CardTitle>
            {household && (
              <Badge
                variant={getHouseholdStatusBadgeVariant(household.status)}
                size="sm"
              >
                {HOUSEHOLD_STATUS_LABELS[household.status]}
              </Badge>
            )}
          </div>
          <CardDescription>
            Detail hunian dan seluruh anggota warga dalam Kartu Keluarga ini.
          </CardDescription>
          {canManage && household && (
            <CardAction>
              <HouseholdEditDialog
                household={household}
                members={householdMembers}
              />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!household ? (
            <p className="text-sm text-muted-foreground">
              Data Kartu Keluarga tidak ditemukan atau telah diarsipkan.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Nomor KK</p>
                  <p className="mt-0.5 font-mono font-medium text-foreground">
                    {sensitiveAccessAllowed
                      ? household.kkNumber
                      : `••••••••••••${household.kkNumber.slice(-4)}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Blok / Unit</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {household.blockUnit ?? "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status Hunian</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {STAY_STATUS_LABELS[household.residenceStatus]}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Kepala Keluarga
                  </p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {headResident?.fullName ?? "Belum ditetapkan"}
                  </p>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <p className="text-xs text-muted-foreground">Alamat</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {household.address}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <UsersIcon className="size-4 text-muted-foreground" />
                    Anggota Keluarga ({householdMembers.length})
                  </h3>
                  <Link
                    href={`/residents?householdId=${household.id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Filter KK di Direktori
                  </Link>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {householdMembers.map((member) => {
                    const isSelf = member.id === resident.id
                    const isHead = household.headResidentId === member.id
                    return (
                      <Link
                        key={member.id}
                        href={`/residents/${member.id}`}
                        className={`flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 ${
                          isSelf
                            ? "border-primary/40 bg-primary-subtle/30"
                            : "border-border bg-surface"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {member.fullName}
                            {isSelf ? " (Sedang dibuka)" : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {FAMILY_ROLE_LABELS[member.familyRole]}
                            {isHead ? " • Kepala Keluarga" : ""}
                          </p>
                        </div>
                        <Badge
                          variant={getResidencyStatusBadgeVariant(
                            member.residencyStatus
                          )}
                          size="sm"
                        >
                          {RESIDENCY_STATUS_LABELS[member.residencyStatus]}
                        </Badge>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Optional Supporting Sections: Vehicles & Documents */}
      {(vehicles.length > 0 ||
        (sensitiveAccessAllowed && documents.length > 0)) && (
        <div className="grid gap-[var(--space-6)] lg:grid-cols-2">
          {vehicles.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CarIcon className="size-4 text-primary" />
                  <CardTitle className="text-base">
                    Kendaraan Terdaftar ({vehicles.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                {vehicles.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5 text-sm"
                  >
                    <div>
                      <p className="font-mono font-medium text-foreground">
                        {vehicle.plateNumber}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {VEHICLE_TYPE_LABELS[vehicle.vehicleType]}
                        {vehicle.brandModel ? ` • ${vehicle.brandModel}` : ""}
                        {vehicle.color ? ` • ${vehicle.color}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {sensitiveAccessAllowed && documents.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileTextIcon className="size-4 text-primary" />
                  <CardTitle className="text-base">
                    Dokumen Kependudukan ({documents.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5 text-sm"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {DOCUMENT_TYPE_LABELS[doc.documentType]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {doc.mimeType} • {formatBytes(doc.fileSizeBytes)}
                      </p>
                    </div>
                    <Badge
                      variant={doc.verifiedAt ? "success" : "warning"}
                      size="sm"
                    >
                      {doc.verifiedAt ? "Terverifikasi" : "Menunggu Verifikasi"}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageContainer>
  )
}

