/* eslint-disable @next/next/no-img-element */
import * as React from "react"
import { BuildingIcon } from "lucide-react"

interface LetterOfficialHeaderProps {
  tenantName?: string
  rtNumber?: string
  rwNumber?: string
  kelurahan?: string
  kecamatan?: string
  city?: string
  province?: string
  postalCode?: string | null
  logoUrl?: string | null
  letterTitle?: string
  letterNumber?: string | null
}

export function LetterOfficialHeader({
  tenantName = "Rukun Tetangga",
  rtNumber = "01",
  rwNumber = "01",
  kelurahan = "Kelurahan",
  kecamatan = "Kecamatan",
  city = "Kota",
  province = "Provinsi",
  postalCode,
  logoUrl,
  letterTitle,
  letterNumber,
}: LetterOfficialHeaderProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
      {/* Kop Surat Header */}
      <div className="flex items-center gap-4 border-b-2 border-double border-foreground/30 pb-4">
        {/* Logo RT */}
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo RT"
              className="size-full object-contain p-1"
            />
          ) : (
            <BuildingIcon className="size-8 text-muted-foreground" />
          )}
        </div>

        {/* Instansi Text */}
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            PENGURUS RUKUN TETANGGA
          </p>
          <h2 className="text-lg font-bold tracking-tight text-foreground uppercase sm:text-xl">
            {tenantName}
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            RT {rtNumber} / RW {rwNumber}, Kelurahan {kelurahan}, Kecamatan {kecamatan},{" "}
            {city}, {province} {postalCode ? `Kode Pos ${postalCode}` : ""}
          </p>
        </div>
      </div>

      {/* Judul & Nomor Surat */}
      {letterTitle && (
        <div className="mt-4 text-center">
          <h3 className="text-base font-bold tracking-tight text-foreground underline underline-offset-4 uppercase">
            {letterTitle}
          </h3>
          {letterNumber && (
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              Nomor: <span className="font-mono text-foreground">{letterNumber}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

