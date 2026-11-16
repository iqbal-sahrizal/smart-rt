import Link from "next/link"
import {
  ArrowRightIcon,
  CarIcon,
  FileTextIcon,
  HomeIcon,
  InfoIcon,
  LockIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"

import { ResidentContainer } from "@/components/resident/resident-container"
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
import type { ResidentPortalData } from "@/lib/residents/queries"
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

function UnlinkedResidentEmptyState({ tenantName }: { tenantName: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserIcon className="size-6" />
        </div>
        <h2 className="text-base font-semibold text-foreground">
          Data Warga Belum Terhubung
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          Akun Anda di {tenantName} belum ditautkan ke data kependudukan warga.
          Silakan hubungi Ketua RT atau Sekretaris untuk menautkan akun ke
          Kartu Keluarga Anda.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/resident" />}
          >
            Kembali ke Beranda Warga
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ResidentProfileView({
  data,
  tenantName,
}: {
  data: ResidentPortalData
  tenantName: string
}) {
  return (
    <ResidentContainer>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Profil Warga Saya
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informasi identitas kependudukan pribadi Anda di {tenantName}.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/resident/household" />}
          >
            <HomeIcon data-icon="inline-start" />
            Kartu Keluarga
          </Button>
        </div>
      </div>

      {!data.linked || !data.resident ? (
        <UnlinkedResidentEmptyState tenantName={tenantName} />
      ) : (
        <>
          <div className="flex items-start gap-2.5 rounded-lg border border-info-border bg-info-subtle px-4 py-3 text-xs text-info-text">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              Data kependudukan bersifat hanya-baca dan dikelola oleh Ketua RT
              atau Sekretaris. Hubungi pengurus RT jika ada pembaruan data.
            </span>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserIcon className="size-4 text-primary" />
                <CardTitle className="text-base">Identitas Diri</CardTitle>
              </div>
              <CardAction>
                <Badge
                  variant={getResidencyStatusBadgeVariant(
                    data.resident.residencyStatus
                  )}
                >
                  {RESIDENCY_STATUS_LABELS[data.resident.residencyStatus]}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Nama Lengkap</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {data.resident.fullName}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Jenis Kelamin</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {GENDER_LABELS[data.resident.gender]}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Peran Keluarga</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {FAMILY_ROLE_LABELS[data.resident.familyRole]}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status Tinggal</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {STAY_STATUS_LABELS[data.resident.stayStatus]}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Nomor Telepon</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {data.resident.phone ?? "Belum dicatat"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <LockIcon className="size-4 text-primary" />
                <CardTitle className="text-base">
                  Data Kependudukan Pribadi
                </CardTitle>
              </div>
              <CardDescription>
                Hanya dapat dilihat oleh Anda sendiri serta Ketua RT dan
                Sekretaris.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.privateData ? (
                <p className="text-sm text-muted-foreground">
                  Data NIK dan informasi kelahiran belum dilengkapi oleh pengurus
                  RT.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">NIK</p>
                    <p className="mt-0.5 font-mono font-medium text-foreground">
                      {data.privateData.nik}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tempat Lahir</p>
                    <p className="mt-0.5 font-medium text-foreground">
                      {data.privateData.birthPlace}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tanggal Lahir</p>
                    <p className="mt-0.5 font-medium text-foreground">
                      {formatIndonesianDate(data.privateData.birthDate)}
                    </p>
                  </div>
                  {data.privateData.extraNotes && (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground">Catatan</p>
                      <p className="mt-0.5 text-foreground">
                        {data.privateData.extraNotes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {data.documents.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileTextIcon className="size-4 text-primary" />
                  <CardTitle className="text-base">Dokumen Pribadi</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5 text-sm"
                  >
                    <span className="font-medium text-foreground">
                      {DOCUMENT_TYPE_LABELS[doc.documentType]}
                    </span>
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

          {data.household && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <HomeIcon className="size-4 text-primary" />
                  <CardTitle className="text-base">
                    Ringkasan Kartu Keluarga
                  </CardTitle>
                </div>
                <CardAction>
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={<Link href="/resident/household" />}
                  >
                    Lihat Detail KK
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Blok / Unit</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {data.household.blockUnit ?? "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status Hunian</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {STAY_STATUS_LABELS[data.household.residenceStatus]}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Alamat</p>
                  <p className="mt-0.5 font-medium text-foreground">
                    {data.household.address}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </ResidentContainer>
  )
}

export function ResidentHouseholdView({
  data,
  tenantName,
}: {
  data: ResidentPortalData
  tenantName: string
}) {
  const headResident = data.household
    ? data.householdMembers.find(
        (m) => m.id === data.household?.headResidentId
      ) ?? null
    : null

  return (
    <ResidentContainer>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Kartu Keluarga Saya
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Informasi rumah, kepala keluarga, dan anggota keluarga di{" "}
            {tenantName}.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/resident/profile" />}
        >
          <UserIcon data-icon="inline-start" />
          Profil Pribadi Saya
        </Button>
      </div>

      {!data.linked || !data.resident || !data.household ? (
        <UnlinkedResidentEmptyState tenantName={tenantName} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <HomeIcon className="size-4 text-primary" />
                <CardTitle className="text-base">
                  Informasi Kartu Keluarga
                </CardTitle>
              </div>
              <CardAction>
                <Badge
                  variant={getHouseholdStatusBadgeVariant(
                    data.household.status
                  )}
                >
                  {HOUSEHOLD_STATUS_LABELS[data.household.status]}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Nomor KK</p>
                <p className="mt-0.5 font-mono font-medium text-foreground">
                  {data.household.kkNumber}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Kepala Keluarga</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {headResident?.fullName ?? "Belum ditetapkan"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Blok / Unit</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {data.household.blockUnit ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status Hunian</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {STAY_STATUS_LABELS[data.household.residenceStatus]}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Alamat Rumah</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {data.household.address}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UsersIcon className="size-4 text-primary" />
                <CardTitle className="text-base">
                  Anggota Keluarga ({data.householdMembers.length})
                </CardTitle>
              </div>
              <CardDescription>
                Data pribadi sensitif (seperti NIK dan tanggal lahir) milik
                anggota keluarga lain tidak ditampilkan demi menjaga privasi.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {data.householdMembers.map((member) => {
                const isSelf = member.id === data.resident?.id
                const isHead = data.household?.headResidentId === member.id
                return (
                  <div
                    key={member.id}
                    className={`flex flex-col justify-between gap-2 rounded-lg border p-3.5 sm:flex-row sm:items-center ${
                      isSelf
                        ? "border-primary/40 bg-primary-subtle/30"
                        : "border-border bg-surface"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {member.fullName}
                        {isSelf ? " (Anda)" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {GENDER_LABELS[member.gender]} •{" "}
                        {FAMILY_ROLE_LABELS[member.familyRole]}
                        {isHead ? " • Kepala Keluarga" : ""}
                        {member.phone ? ` • ${member.phone}` : ""}
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
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {data.vehicles.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CarIcon className="size-4 text-primary" />
                  <CardTitle className="text-base">
                    Kendaraan Keluarga ({data.vehicles.length})
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.vehicles.map((vehicle) => (
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
        </>
      )}
    </ResidentContainer>
  )
}

