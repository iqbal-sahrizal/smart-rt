"use client"

import * as React from "react"
import Link from "next/link"
import { AlertCircleIcon, ArrowLeftIcon, SaveIcon } from "lucide-react"

import { createDuesAction, updateDuesAction } from "@/app/actions/finance"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type {
  DuesBillingCycle,
  DuesTargetScope,
  FinanceFormActionState,
} from "@/lib/finance/types"

interface DuesFormProps {
  mode: "create" | "edit"
  initialValues?: {
    dueId: string
    name: string
    description: string | null
    amount: number
    billingCycle: DuesBillingCycle
    targetScope: DuesTargetScope
    isActive: boolean
    billCount?: number
  }
}

const INITIAL_STATE: FinanceFormActionState = { error: null }

export function DuesForm({ mode, initialValues }: DuesFormProps) {
  const actionFn = mode === "edit" ? updateDuesAction : createDuesAction
  const [state, formAction, isPending] = React.useActionState(
    actionFn,
    INITIAL_STATE
  )

  const [isActive, setIsActive] = React.useState<boolean>(
    initialValues?.isActive ?? true
  )

  const scopeLocked =
    mode === "edit" && (initialValues?.billCount ?? 0) > 0

  const backHref =
    mode === "edit" && initialValues ? `/dues/${initialValues.dueId}` : "/dues"

  return (
    <PageContainer>
      <PageHeader
        title={
          mode === "edit"
            ? "Ubah Konfigurasi Iuran"
            : "Tambah Konfigurasi Iuran"
        }
        description={
          mode === "edit"
            ? "Perbarui tarif, siklus penagihan, atau status aktif jenis iuran RT."
            : "Tetapkan tarif dan cakupan tagihan baru untuk warga RT."
        }
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={backHref} />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali</span>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detail Tarif Iuran</CardTitle>
          <CardDescription>
            Tarif default akan digunakan sebagai acuan saat menerbitkan tagihan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-[var(--space-5)]">
            {mode === "edit" && initialValues && (
              <input type="hidden" name="dueId" value={initialValues.dueId} />
            )}

            {state.error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label
                htmlFor="dues-name"
                className="text-sm font-medium text-foreground"
              >
                Nama Iuran
              </label>
              <Input
                id="dues-name"
                name="name"
                required
                minLength={3}
                maxLength={120}
                defaultValue={initialValues?.name ?? ""}
                placeholder="Contoh: Iuran Kebersihan & Keamanan Bulanan"
                disabled={isPending}
              />
              {state.fieldErrors?.name?.[0] && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.name[0]}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="dues-description"
                className="text-sm font-medium text-foreground"
              >
                Keterangan (Opsional)
              </label>
              <textarea
                id="dues-description"
                name="description"
                rows={3}
                maxLength={1000}
                defaultValue={initialValues?.description ?? ""}
                placeholder="Rincian peruntukan dana iuran atau catatan untuk warga..."
                disabled={isPending}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {state.fieldErrors?.description?.[0] && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.description[0]}
                </p>
              )}
            </div>

            <div className="grid gap-[var(--space-4)] sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="dues-amount"
                  className="text-sm font-medium text-foreground"
                >
                  Nominal Default (Rp)
                </label>
                <Input
                  id="dues-amount"
                  name="amount"
                  type="number"
                  min={0}
                  step="1"
                  required
                  defaultValue={
                    initialValues ? String(initialValues.amount) : ""
                  }
                  placeholder="Contoh: 150000"
                  disabled={isPending}
                />
                {state.fieldErrors?.amount?.[0] && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.amount[0]}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="dues-cycle"
                  className="text-sm font-medium text-foreground"
                >
                  Siklus Penagihan
                </label>
                <select
                  id="dues-cycle"
                  name="billingCycle"
                  defaultValue={initialValues?.billingCycle ?? "monthly"}
                  disabled={isPending}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="monthly">Bulanan</option>
                  <option value="yearly">Tahunan</option>
                  <option value="one_time">Sekali Bayar</option>
                </select>
                {state.fieldErrors?.billingCycle?.[0] && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.billingCycle[0]}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="dues-scope"
                  className="text-sm font-medium text-foreground"
                >
                  Cakupan Target
                </label>
                {scopeLocked ? (
                  <>
                    <input
                      type="hidden"
                      name="targetScope"
                      value={initialValues?.targetScope}
                    />
                    <select
                      id="dues-scope"
                      value={initialValues?.targetScope}
                      disabled
                      className="h-9 rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
                    >
                      <option value="household">Per Kartu Keluarga</option>
                      <option value="resident">Per Warga</option>
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      Terkunci karena sudah terdapat {initialValues?.billCount}{" "}
                      tagihan terkait.
                    </p>
                  </>
                ) : (
                  <select
                    id="dues-scope"
                    name="targetScope"
                    defaultValue={initialValues?.targetScope ?? "household"}
                    disabled={isPending}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="household">Per Kartu Keluarga</option>
                    <option value="resident">Per Warga</option>
                  </select>
                )}
                {state.fieldErrors?.targetScope?.[0] && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.targetScope[0]}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name="isActive"
                  value="true"
                  checked={isActive}
                  disabled={isPending}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="size-4 accent-primary"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Status Iuran Aktif
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hanya konfigurasi iuran aktif yang dapat dipilih untuk
                    menerbitkan tagihan baru dan dilihat oleh warga.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link href={backHref} />}
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                data-testid="submit-dues-btn"
              >
                <SaveIcon className="size-4" />
                <span>
                  {isPending
                    ? "Menyimpan..."
                    : mode === "edit"
                      ? "Simpan Perubahan"
                      : "Simpan Iuran"}
                </span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

