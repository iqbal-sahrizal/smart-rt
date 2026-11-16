"use client"

import * as React from "react"
import {
  FileTextIcon,
  MessageSquareWarningIcon,
  WalletIcon,
} from "lucide-react"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  ComplaintTrendBucket,
  LetterDistributionItem,
  PaymentTrendBucket,
} from "@/lib/analytics/types"
import { formatIdr } from "@/lib/finance/types"

export function PaymentTrendChart({
  data,
  isLoading = false,
}: {
  data: PaymentTrendBucket[]
  isLoading?: boolean
}) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)

  if (isLoading) {
    return <Skeleton className="h-48 w-full rounded-lg" />
  }

  const hasAnyPayments = data.some(
    (b) => b.netAmount > 0 || b.verifiedAmount > 0
  )

  if (data.length === 0 || !hasAnyPayments) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
        <WalletIcon className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Belum ada pembayaran terverifikasi
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Tren pembayaran iuran terverifikasi pada periode terpilih akan tampil
          di sini.
        </p>
      </div>
    )
  }

  const maxAmount = Math.max(...data.map((b) => b.netAmount), 1)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        {hoveredIndex !== null && data[hoveredIndex] ? (
          <span>
            <strong className="font-medium text-foreground">
              {data[hoveredIndex].label}:
            </strong>{" "}
            {formatIdr(data[hoveredIndex].netAmount)} (
            {data[hoveredIndex].verifiedCount} transaksi)
          </span>
        ) : (
          <span>Pembayaran iuran neto terverifikasi per sub-periode</span>
        )}
        <span className="inline-flex items-center gap-1.5 text-foreground-secondary">
          <span
            className="size-2.5 rounded-xs"
            style={{ backgroundColor: "var(--chart-3)" }}
          />
          Iuran Masuk
        </span>
      </div>

      <div
        className="grid h-44 items-end gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle/30 px-3 pt-4 pb-2 sm:gap-2.5"
        style={{
          gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
        }}
      >
        {data.map((bucket, idx) => {
          const pct =
            bucket.netAmount > 0
              ? Math.max(Math.round((bucket.netAmount / maxAmount) * 100), 6)
              : 0
          const isHovered = hoveredIndex === idx

          return (
            <div
              key={bucket.key}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="flex h-full flex-col items-center justify-end gap-1.5"
            >
              <div className="flex h-full w-full items-end justify-center">
                <div
                  title={`${bucket.label}: ${formatIdr(bucket.netAmount)} (${bucket.verifiedCount} pembayaran)`}
                  className="w-4 rounded-t-sm transition-all duration-200 sm:w-6"
                  style={{
                    height: `${pct}%`,
                    backgroundColor: "var(--chart-3)",
                    opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1,
                  }}
                />
              </div>
              <span
                className={cn(
                  "max-w-full truncate text-[11px]",
                  isHovered
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {bucket.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ComplaintTrendChart({
  data,
  isLoading = false,
}: {
  data: ComplaintTrendBucket[]
  isLoading?: boolean
}) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)

  if (isLoading) {
    return <Skeleton className="h-48 w-full rounded-lg" />
  }

  const hasAnyComplaints = data.some((b) => b.total > 0)

  if (data.length === 0 || !hasAnyComplaints) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
        <MessageSquareWarningIcon className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Tidak ada pengaduan pada periode ini
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Laporan pengaduan warga yang masuk pada rentang waktu ini akan
          divisualisasikan di sini.
        </p>
      </div>
    )
  }

  const maxTotal = Math.max(...data.map((b) => b.total), 1)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        {hoveredIndex !== null && data[hoveredIndex] ? (
          <span>
            <strong className="font-medium text-foreground">
              {data[hoveredIndex].label}:
            </strong>{" "}
            {data[hoveredIndex].total} aduan (
            {data[hoveredIndex].open + data[hoveredIndex].inProgress} aktif •{" "}
            {data[hoveredIndex].resolved} selesai)
          </span>
        ) : (
          <span>Jumlah laporan pengaduan per periode</span>
        )}
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2.5 rounded-xs"
              style={{ backgroundColor: "var(--chart-4)" }}
            />
            Aktif
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="size-2.5 rounded-xs"
              style={{ backgroundColor: "var(--chart-1)" }}
            />
            Selesai
          </span>
        </div>
      </div>

      <div
        className="grid h-44 items-end gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle/30 px-3 pt-4 pb-2 sm:gap-2.5"
        style={{
          gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
        }}
      >
        {data.map((bucket, idx) => {
          const activeCount = bucket.open + bucket.inProgress
          const activePct =
            activeCount > 0
              ? Math.max(Math.round((activeCount / maxTotal) * 100), 6)
              : 0
          const resolvedPct =
            bucket.resolved > 0
              ? Math.max(Math.round((bucket.resolved / maxTotal) * 100), 6)
              : 0
          const isHovered = hoveredIndex === idx

          return (
            <div
              key={bucket.key}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="flex h-full flex-col items-center justify-end gap-1.5"
            >
              <div className="flex h-full w-full items-end justify-center gap-1">
                <div
                  title={`${bucket.label} Aktif: ${activeCount}`}
                  className="w-2.5 rounded-t-sm transition-all duration-200 sm:w-3.5"
                  style={{
                    height: `${activePct}%`,
                    backgroundColor: "var(--chart-4)",
                    opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1,
                  }}
                />
                <div
                  title={`${bucket.label} Selesai: ${bucket.resolved}`}
                  className="w-2.5 rounded-t-sm transition-all duration-200 sm:w-3.5"
                  style={{
                    height: `${resolvedPct}%`,
                    backgroundColor: "var(--chart-1)",
                    opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1,
                  }}
                />
              </div>
              <span
                className={cn(
                  "max-w-full truncate text-[11px]",
                  isHovered
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {bucket.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const LETTER_BAR_COLORS: Record<LetterDistributionItem["status"], string> = {
  submitted: "var(--chart-4)",
  reviewing: "var(--chart-3)",
  approved: "var(--chart-1)",
  completed: "var(--chart-5)",
  rejected: "var(--chart-2)",
  cancelled: "var(--muted-foreground)",
}

export function LetterDistributionChart({
  data,
  totalInPeriod,
  isLoading = false,
}: {
  data: LetterDistributionItem[]
  totalInPeriod: number
  isLoading?: boolean
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((idx) => (
          <Skeleton key={idx} className="h-8 w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (totalInPeriod === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-subtle/40 px-4 text-center">
        <FileTextIcon className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Belum ada permohonan surat pada periode ini
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Distribusi status pengajuan surat pengantar warga akan tampil di sini.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Total pengajuan dalam periode</span>
        <Badge variant="outline" size="sm">
          {totalInPeriod} Permohonan
        </Badge>
      </div>
      <div className="space-y-2.5">
        {data.map((item) => (
          <div key={item.status} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {item.count} ({item.percentage}%)
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/70">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${item.percentage}%`,
                  backgroundColor: LETTER_BAR_COLORS[item.status],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

