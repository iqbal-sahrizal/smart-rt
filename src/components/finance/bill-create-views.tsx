"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  LayersIcon,
  ReceiptIcon,
} from "lucide-react"

import { createBillAction, generateBillsAction } from "@/app/actions/finance"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DUES_BILLING_CYCLE_LABELS,
  DUES_TARGET_SCOPE_LABELS,
  INDONESIAN_MONTH_NAMES,
  formatIdr,
  getJakartaTodayIsoDate,
  type DuesSummary,
  type DuesTargetHouseholdOption,
  type DuesTargetResidentOption,
  type FinanceFormActionState,
} from "@/lib/finance/types"

interface BillCreateViewsProps {
  dues: DuesSummary[]
  households: DuesTargetHouseholdOption[]
  residents: DuesTargetResidentOption[]
  existingBillKeys: string[]
  initialDueId?: string
}

const INITIAL_STATE: FinanceFormActionState = { error: null }

function getDefaultDueDateIso(): string {
  const today = getJakartaTodayIsoDate()
  const [y, m] = today.split("-").map((v) => Number.parseInt(v, 10))
  const nextDay = new Date(Date.UTC(y, m - 1, 20))
  return nextDay.toISOString().slice(0, 10)
}

export function BillCreateViews({
  dues,
  households,
  residents,
  existingBillKeys,
  initialDueId,
}: BillCreateViewsProps) {
  const [mode, setMode] = React.useState<"single" | "batch">("single")

  const initialDue =
    dues.find((d) => d.id === initialDueId) ?? dues[0] ?? null

  const todayParts = getJakartaTodayIsoDate().split("-")
  const defaultYear = Number.parseInt(todayParts[0] || "2026", 10)
  const defaultMonth = Number.parseInt(todayParts[1] || "1", 10)
  const defaultDueDate = getDefaultDueDateIso()

  // Single bill state
  const [singleState, singleFormAction, isSinglePending] = React.useActionState(
    createBillAction,
    INITIAL_STATE
  )
  const [singleDueId, setSingleDueId] = React.useState<string>(
    initialDue?.id ?? ""
  )
  const [singleAmount, setSingleAmount] = React.useState<string>(
    initialDue ? String(initialDue.amount) : ""
  )

  // Batch generation state
  const [batchState, batchFormAction, isBatchPending] = React.useActionState(
    generateBillsAction,
    INITIAL_STATE
  )
  const [batchDueId, setBatchDueId] = React.useState<string>(
    initialDue?.id ?? ""
  )
  const [batchAmount, setBatchAmount] = React.useState<string>(
    initialDue ? String(initialDue.amount) : ""
  )
  const [batchYear, setBatchYear] = React.useState<number>(defaultYear)
  const [batchMonth, setBatchMonth] = React.useState<number>(defaultMonth)
  const [batchTargetMode, setBatchTargetMode] = React.useState<
    "all_active" | "selected"
  >("all_active")
  const [selectedBatchTargets, setSelectedBatchTargets] = React.useState<
    string[]
  >([])

  const existingSet = React.useMemo(
    () => new Set(existingBillKeys),
    [existingBillKeys]
  )

  const selectedSingleDue = dues.find((d) => d.id === singleDueId) ?? null
  const selectedBatchDue = dues.find((d) => d.id === batchDueId) ?? null

  const singleTargets =
    selectedSingleDue?.targetScope === "resident" ? residents : households

  const batchCandidateIds = React.useMemo(() => {
    if (!selectedBatchDue) return []
    const allIds =
      selectedBatchDue.targetScope === "resident"
        ? residents.map((r) => r.id)
        : households.map((h) => h.id)
    if (batchTargetMode === "all_active") return allIds
    return allIds.filter((id) => selectedBatchTargets.includes(id))
  }, [
    selectedBatchDue,
    residents,
    households,
    batchTargetMode,
    selectedBatchTargets,
  ])

  const batchPreview = React.useMemo(() => {
    if (!selectedBatchDue) {
      return { totalSelected: 0, newCount: 0, duplicateCount: 0, totalAmount: 0 }
    }
    let duplicateCount = 0
    for (const tid of batchCandidateIds) {
      if (
        existingSet.has(
          `${selectedBatchDue.id}|${tid}|${batchYear}|${batchMonth}`
        )
      ) {
        duplicateCount += 1
      }
    }
    const newCount = Math.max(0, batchCandidateIds.length - duplicateCount)
    const parsedAmt = Number.parseFloat(batchAmount || "0")
    const unitAmount = Number.isFinite(parsedAmt) && parsedAmt >= 0 ? parsedAmt : 0
    return {
      totalSelected: batchCandidateIds.length,
      newCount,
      duplicateCount,
      totalAmount: newCount * unitAmount,
    }
  }, [
    selectedBatchDue,
    batchCandidateIds,
    existingSet,
    batchYear,
    batchMonth,
    batchAmount,
  ])

  const toggleBatchTarget = (id: string) => {
    setSelectedBatchTargets((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  if (dues.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Buat Tagihan Warga"
          description="Terbitkan tagihan baru berdasarkan konfigurasi iuran aktif."
          actions={
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/bills" />}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Kembali</span>
            </Button>
          }
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ReceiptIcon className="size-10 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">
              Belum ada konfigurasi iuran aktif
            </p>
            <p className="text-xs text-muted-foreground">
              Buat atau aktifkan minimal satu jenis iuran terlebih dahulu sebelum
              menerbitkan tagihan.
            </p>
            <Button
              nativeButton={false}
              size="sm"
              render={<Link href="/dues/new" />}
            >
              <span>Tambah Konfigurasi Iuran</span>
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Terbitkan Tagihan Warga"
        description="Buat tagihan satuan untuk satu target atau terbitkan massal per periode berdasarkan jenis iuran aktif."
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href="/bills" />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Daftar</span>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={mode === "single" ? "default" : "outline"}
          onClick={() => setMode("single")}
          data-testid="tab-single-bill"
        >
          <ReceiptIcon className="size-4" />
          <span>Tagihan Satuan</span>
        </Button>
        <Button
          type="button"
          variant={mode === "batch" ? "default" : "outline"}
          onClick={() => setMode("batch")}
          data-testid="tab-batch-bill"
        >
          <LayersIcon className="size-4" />
          <span>Terbitkan Massal (Batch)</span>
        </Button>
      </div>

      {mode === "single" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Formulir Tagihan Satuan</CardTitle>
            <CardDescription>
              Pilih jenis iuran aktif dan satu target sesuai cakupannya (Kartu
              Keluarga atau Warga). Tidak membuat catatan pembayaran.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={singleFormAction}
              className="flex flex-col gap-[var(--space-5)]"
            >
              {singleState.error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{singleState.error}</span>
                </div>
              )}

              <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <label
                    htmlFor="single-due-id"
                    className="text-sm font-medium text-foreground"
                  >
                    Jenis Iuran
                  </label>
                  <select
                    id="single-due-id"
                    name="dueId"
                    value={singleDueId}
                    onChange={(event) => {
                      const nextId = event.target.value
                      setSingleDueId(nextId)
                      const found = dues.find((d) => d.id === nextId)
                      if (found) setSingleAmount(String(found.amount))
                    }}
                    disabled={isSinglePending}
                    className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    {dues.map((due) => (
                      <option key={due.id} value={due.id}>
                        {due.name} — {formatIdr(due.amount)} (
                        {DUES_TARGET_SCOPE_LABELS[due.targetScope]})
                      </option>
                    ))}
                  </select>
                  {selectedSingleDue && (
                    <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="info" size="sm">
                        {
                          DUES_BILLING_CYCLE_LABELS[
                            selectedSingleDue.billingCycle
                          ]
                        }
                      </Badge>
                      <Badge variant="outline" size="sm">
                        {
                          DUES_TARGET_SCOPE_LABELS[
                            selectedSingleDue.targetScope
                          ]
                        }
                      </Badge>
                    </div>
                  )}
                  {singleState.fieldErrors?.dueId?.[0] && (
                    <p className="text-xs text-destructive">
                      {singleState.fieldErrors.dueId[0]}
                    </p>
                  )}
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <label
                    htmlFor="single-target-id"
                    className="text-sm font-medium text-foreground"
                  >
                    {selectedSingleDue?.targetScope === "resident"
                      ? "Warga Penerima Tagihan"
                      : "Kartu Keluarga Penerima Tagihan"}
                  </label>
                  <select
                    id="single-target-id"
                    name="targetId"
                    required
                    disabled={isSinglePending || singleTargets.length === 0}
                    className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    <option value="">
                      {singleTargets.length === 0
                        ? "Tidak ada target aktif"
                        : selectedSingleDue?.targetScope === "resident"
                          ? "Pilih warga aktif..."
                          : "Pilih Kartu Keluarga aktif..."}
                    </option>
                    {selectedSingleDue?.targetScope === "resident"
                      ? residents.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.fullName}
                            {r.householdLabel ? ` (${r.householdLabel})` : ""}
                          </option>
                        ))
                      : households.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label}
                          </option>
                        ))}
                  </select>
                  {singleState.fieldErrors?.targetId?.[0] && (
                    <p className="text-xs text-destructive">
                      {singleState.fieldErrors.targetId[0]}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-[var(--space-4)] sm:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="single-period-month"
                    className="text-sm font-medium text-foreground"
                  >
                    Bulan Periode
                  </label>
                  <select
                    id="single-period-month"
                    name="periodMonth"
                    defaultValue={String(defaultMonth)}
                    disabled={isSinglePending}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    {INDONESIAN_MONTH_NAMES.map((label, idx) => (
                      <option key={label} value={String(idx + 1)}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {singleState.fieldErrors?.periodMonth?.[0] && (
                    <p className="text-xs text-destructive">
                      {singleState.fieldErrors.periodMonth[0]}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="single-period-year"
                    className="text-sm font-medium text-foreground"
                  >
                    Tahun Periode
                  </label>
                  <Input
                    id="single-period-year"
                    name="periodYear"
                    type="number"
                    min={2000}
                    max={2100}
                    required
                    defaultValue={String(defaultYear)}
                    disabled={isSinglePending}
                  />
                  {singleState.fieldErrors?.periodYear?.[0] && (
                    <p className="text-xs text-destructive">
                      {singleState.fieldErrors.periodYear[0]}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="single-amount"
                    className="text-sm font-medium text-foreground"
                  >
                    Nominal Tagihan (Rp)
                  </label>
                  <Input
                    id="single-amount"
                    name="amount"
                    type="number"
                    min={0}
                    step="1"
                    required
                    value={singleAmount}
                    onChange={(e) => setSingleAmount(e.target.value)}
                    disabled={isSinglePending}
                  />
                  {singleState.fieldErrors?.amount?.[0] && (
                    <p className="text-xs text-destructive">
                      {singleState.fieldErrors.amount[0]}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="single-due-date"
                    className="text-sm font-medium text-foreground"
                  >
                    Jatuh Tempo
                  </label>
                  <Input
                    id="single-due-date"
                    name="dueDate"
                    type="date"
                    required
                    defaultValue={defaultDueDate}
                    disabled={isSinglePending}
                  />
                  {singleState.fieldErrors?.dueDate?.[0] && (
                    <p className="text-xs text-destructive">
                      {singleState.fieldErrors.dueDate[0]}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  nativeButton={false}
                  variant="outline"
                  render={<Link href="/bills" />}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  disabled={isSinglePending || singleTargets.length === 0}
                  data-testid="submit-single-bill-btn"
                >
                  <ReceiptIcon className="size-4" />
                  <span>
                    {isSinglePending ? "Menerbitkan..." : "Terbitkan Tagihan"}
                  </span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Terbitkan Tagihan Massal (Batch)
            </CardTitle>
            <CardDescription>
              Terbitkan tagihan sekaligus untuk seluruh atau sebagian target
              aktif. Duplikat periode yang sudah memiliki tagihan aktif akan
              otomatis dilewati oleh indeks unik database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={batchFormAction}
              className="flex flex-col gap-[var(--space-5)]"
            >
              {batchState.error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{batchState.error}</span>
                </div>
              )}

              {batchState.successMessage && (
                <div
                  role="status"
                  className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <CheckCircle2Icon className="size-4 shrink-0" />
                    <span>{batchState.successMessage}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span>
                      Diterbitkan: {batchState.generationResult?.createdCount ?? 0}
                    </span>
                    <span>
                      Dilewati (duplikat):{" "}
                      {batchState.generationResult?.skippedCount ?? 0}
                    </span>
                    <span>
                      Total Nilai:{" "}
                      {formatIdr(batchState.generationResult?.totalNominal ?? 0)}
                    </span>
                    <Link
                      href="/bills"
                      className="font-semibold underline hover:opacity-80"
                    >
                      Lihat Daftar Tagihan →
                    </Link>
                  </div>
                </div>
              )}

              <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <label
                    htmlFor="batch-due-id"
                    className="text-sm font-medium text-foreground"
                  >
                    Jenis Iuran
                  </label>
                  <select
                    id="batch-due-id"
                    name="dueId"
                    value={batchDueId}
                    onChange={(event) => {
                      const nextId = event.target.value
                      setBatchDueId(nextId)
                      setSelectedBatchTargets([])
                      const found = dues.find((d) => d.id === nextId)
                      if (found) setBatchAmount(String(found.amount))
                    }}
                    disabled={isBatchPending}
                    className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    {dues.map((due) => (
                      <option key={due.id} value={due.id}>
                        {due.name} — {formatIdr(due.amount)} (
                        {DUES_TARGET_SCOPE_LABELS[due.targetScope]})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="batch-target-mode"
                    className="text-sm font-medium text-foreground"
                  >
                    Pilihan Target
                  </label>
                  <select
                    id="batch-target-mode"
                    name="targetMode"
                    value={batchTargetMode}
                    onChange={(event) =>
                      setBatchTargetMode(
                        event.target.value as "all_active" | "selected"
                      )
                    }
                    disabled={isBatchPending}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    <option value="all_active">
                      {selectedBatchDue?.targetScope === "resident"
                        ? `Seluruh Warga Aktif (${residents.length})`
                        : `Seluruh Kartu Keluarga Aktif (${households.length})`}
                    </option>
                    <option value="selected">Pilih Target Tertentu</option>
                  </select>
                </div>
              </div>

              {batchTargetMode === "selected" && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground">
                    Pilih{" "}
                    {selectedBatchDue?.targetScope === "resident"
                      ? "Warga"
                      : "Kartu Keluarga"}
                  </p>
                  <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                    {selectedBatchDue?.targetScope === "resident"
                      ? residents.map((r) => (
                          <label
                            key={r.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted/40"
                          >
                            <input
                              type="checkbox"
                              name="selectedTargetIds"
                              value={r.id}
                              checked={selectedBatchTargets.includes(r.id)}
                              onChange={() => toggleBatchTarget(r.id)}
                              className="size-4 accent-primary"
                            />
                            <span className="truncate font-medium text-foreground">
                              {r.fullName}
                            </span>
                          </label>
                        ))
                      : households.map((h) => (
                          <label
                            key={h.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted/40"
                          >
                            <input
                              type="checkbox"
                              name="selectedTargetIds"
                              value={h.id}
                              checked={selectedBatchTargets.includes(h.id)}
                              onChange={() => toggleBatchTarget(h.id)}
                              className="size-4 accent-primary"
                            />
                            <span className="truncate font-medium text-foreground">
                              {h.label}
                            </span>
                          </label>
                        ))}
                  </div>
                  {batchState.fieldErrors?.selectedTargetIds?.[0] && (
                    <p className="text-xs text-destructive">
                      {batchState.fieldErrors.selectedTargetIds[0]}
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-[var(--space-4)] sm:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="batch-period-month"
                    className="text-sm font-medium text-foreground"
                  >
                    Bulan Periode
                  </label>
                  <select
                    id="batch-period-month"
                    name="periodMonth"
                    value={String(batchMonth)}
                    onChange={(e) =>
                      setBatchMonth(Number.parseInt(e.target.value, 10))
                    }
                    disabled={isBatchPending}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  >
                    {INDONESIAN_MONTH_NAMES.map((label, idx) => (
                      <option key={label} value={String(idx + 1)}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="batch-period-year"
                    className="text-sm font-medium text-foreground"
                  >
                    Tahun Periode
                  </label>
                  <Input
                    id="batch-period-year"
                    name="periodYear"
                    type="number"
                    min={2000}
                    max={2100}
                    required
                    value={String(batchYear)}
                    onChange={(e) =>
                      setBatchYear(
                        Number.parseInt(e.target.value || String(defaultYear), 10)
                      )
                    }
                    disabled={isBatchPending}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="batch-amount"
                    className="text-sm font-medium text-foreground"
                  >
                    Nominal per Target (Rp)
                  </label>
                  <Input
                    id="batch-amount"
                    name="amount"
                    type="number"
                    min={0}
                    step="1"
                    required
                    value={batchAmount}
                    onChange={(e) => setBatchAmount(e.target.value)}
                    disabled={isBatchPending}
                  />
                  {batchState.fieldErrors?.amount?.[0] && (
                    <p className="text-xs text-destructive">
                      {batchState.fieldErrors.amount[0]}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="batch-due-date"
                    className="text-sm font-medium text-foreground"
                  >
                    Jatuh Tempo
                  </label>
                  <Input
                    id="batch-due-date"
                    name="dueDate"
                    type="date"
                    required
                    defaultValue={defaultDueDate}
                    disabled={isBatchPending}
                  />
                  {batchState.fieldErrors?.dueDate?.[0] && (
                    <p className="text-xs text-destructive">
                      {batchState.fieldErrors.dueDate[0]}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 rounded-lg border border-border bg-surface-subtle/50 p-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Target Dipilih</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {batchPreview.totalSelected}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Akan Diterbitkan
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-primary">
                    {batchPreview.newCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Sudah Ada (Dilewati)
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-muted-foreground">
                    {batchPreview.duplicateCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Estimasi Total Tagihan Baru
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {formatIdr(batchPreview.totalAmount)}
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  nativeButton={false}
                  variant="outline"
                  render={<Link href="/bills" />}
                >
                  Kembali
                </Button>
                <Button
                  type="submit"
                  disabled={isBatchPending || batchPreview.totalSelected === 0}
                  data-testid="submit-batch-bill-btn"
                >
                  <LayersIcon className="size-4" />
                  <span>
                    {isBatchPending
                      ? "Memproses..."
                      : `Konfirmasi & Terbitkan (${batchPreview.newCount} Tagihan)`}
                  </span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}

