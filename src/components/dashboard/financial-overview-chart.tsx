"use client"

import * as React from "react"
import { BarChart3Icon } from "lucide-react"
import { cn } from "cn"

import { Skeleton } from "@/components/ui/skeleton"
import type { CashTrendBucket } from "@/lib/analytics/types"
import { formatIdr } from "@/lib/finance/types"

interface FinancialOverviewChartProps {
  data: CashTrendBucket[]
  isLoading?: boolean
}

function formatCompactRupiah(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `Rp ${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")} M`
  }
  if (Math.abs(value) >= 1_000_000) {
    return `Rp ${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")} jt`
  }
  if (Math.abs(value) >= 1_000) {
    return `Rp ${Math.round(value / 1_000).toLocaleString("id-ID")} rb`
  }
  return formatIdr(value)
}

export function FinancialOverviewChart({
  data,
  isLoading = false,
}: FinancialOverviewChartProps) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-[var(--space-4)]">
        <div className="flex items-center justify-end gap-[var(--space-4)]">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="grid h-56 grid-cols-6 items-end gap-[var(--space-3)] pt-[var(--space-4)]">
          {[65, 80, 75, 70, 90, 95].map((height, idx) => (
            <div
              key={idx}
              className="flex h-full items-end justify-center gap-1.5"
            >
              <Skeleton
                className="w-4 rounded-t-sm"
                style={{ height: `${height}%` }}
              />
              <Skeleton
                className="w-4 rounded-t-sm"
                style={{ height: `${Math.round(height * 0.55)}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const hasAnyValues = data.some((item) => item.income > 0 || item.expense > 0)

  if (data.length === 0 || !hasAnyValues) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-[var(--space-2)] rounded-lg border border-dashed border-border bg-surface-subtle/40 px-[var(--space-4)] text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <BarChart3Icon className="size-[var(--size-icon-lg)]" />
        </div>
        <p className="text-sm font-medium text-foreground">
          Belum ada transaksi kas pada periode ini
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Grafik pemasukan dan pengeluaran kas RT akan muncul otomatis setelah
          transaksi dicatat.
        </p>
      </div>
    )
  }

  const maxValue = Math.max(
    ...data.flatMap((item) => [item.income, item.expense]),
    1
  )
  const yTicks = [1, 0.75, 0.5, 0.25, 0]
  const barWidthClass = data.length > 8 ? "w-2 sm:w-3" : "w-3 sm:w-4"

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div className="text-xs text-muted-foreground tabular-nums">
          {hoveredIndex !== null && data[hoveredIndex] ? (
            <span>
              <strong className="font-medium text-foreground">
                {data[hoveredIndex].label}:
              </strong>{" "}
              Masuk {formatIdr(data[hoveredIndex].income)} • Keluar{" "}
              {formatIdr(data[hoveredIndex].expense)}
            </span>
          ) : (
            <span>Arahkan kursor ke batang grafik untuk rincian nominal</span>
          )}
        </div>

        <div className="flex items-center gap-[var(--space-4)] text-xs">
          <span className="inline-flex items-center gap-[var(--space-1-5)] text-foreground-secondary">
            <span
              className="size-2.5 rounded-xs"
              style={{ backgroundColor: "var(--chart-1)" }}
            />
            Pemasukan
          </span>
          <span className="inline-flex items-center gap-[var(--space-1-5)] text-foreground-secondary">
            <span
              className="size-2.5 rounded-xs"
              style={{ backgroundColor: "var(--chart-2)" }}
            />
            Pengeluaran
          </span>
        </div>
      </div>

      <div className="relative flex h-56 gap-[var(--space-3)] pt-[var(--space-2)]">
        <div className="hidden flex-col justify-between pb-6 text-right text-[11px] text-muted-foreground tabular-nums sm:flex">
          {yTicks.map((ratio) => (
            <span key={ratio}>
              {formatCompactRupiah(Math.round(maxValue * ratio))}
            </span>
          ))}
        </div>

        <div className="relative flex flex-1 flex-col">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between"
          >
            {yTicks.map((ratio) => (
              <div
                key={ratio}
                className="w-full border-b border-dashed border-border-subtle"
              />
            ))}
          </div>

          <div
            className="relative z-10 grid flex-1 gap-1.5 sm:gap-2.5"
            style={{
              gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
            }}
          >
            {data.map((item, idx) => {
              const incomePct =
                item.income > 0 ? Math.max(Math.round((item.income / maxValue) * 100), 4) : 0
              const expensePct =
                item.expense > 0 ? Math.max(Math.round((item.expense / maxValue) * 100), 4) : 0
              const isHovered = hoveredIndex === idx

              return (
                <div
                  key={item.key}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="flex flex-col items-center justify-end gap-[var(--space-2)]"
                >
                  <div
                    className={cn(
                      "flex h-full w-full items-end justify-center gap-0.5 rounded-md px-0.5 transition-colors duration-150 sm:gap-1",
                      isHovered && "bg-surface-subtle/60"
                    )}
                  >
                    <div
                      title={`Pemasukan ${item.label}: ${formatIdr(item.income)}`}
                      className={cn(
                        barWidthClass,
                        "rounded-t-sm transition-all duration-200"
                      )}
                      style={{
                        height: `${incomePct}%`,
                        backgroundColor: "var(--chart-1)",
                        opacity: hoveredIndex !== null && !isHovered ? 0.55 : 1,
                      }}
                    />
                    <div
                      title={`Pengeluaran ${item.label}: ${formatIdr(item.expense)}`}
                      className={cn(
                        barWidthClass,
                        "rounded-t-sm transition-all duration-200"
                      )}
                      style={{
                        height: `${expensePct}%`,
                        backgroundColor: "var(--chart-2)",
                        opacity: hoveredIndex !== null && !isHovered ? 0.55 : 1,
                      }}
                    />
                  </div>
                  <span
                    className={cn(
                      "truncate max-w-full text-[11px] transition-colors duration-150",
                      isHovered
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {item.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

