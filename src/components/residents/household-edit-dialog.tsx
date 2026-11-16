"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertCircleIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import { updateHouseholdAction } from "@/app/actions/residents"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  HOUSEHOLD_STATUS_LABELS,
  STAY_STATUS_LABELS,
  type HouseholdFormActionState,
  type HouseholdSummary,
  type ResidentSummary,
} from "@/lib/residents/types"

const INITIAL_STATE: HouseholdFormActionState = {
  error: null,
  successMessage: null,
}

interface HouseholdEditDialogProps {
  household: HouseholdSummary
  members: ResidentSummary[]
  buttonLabel?: string
  buttonVariant?: "outline" | "default" | "secondary" | "ghost"
  buttonSize?: "sm" | "default"
}

export function HouseholdEditDialog({
  household,
  members,
  buttonLabel = "Ubah Data KK",
  buttonVariant = "outline",
  buttonSize = "sm",
}: HouseholdEditDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, formAction, isPending] = React.useActionState(
    async (prevState: HouseholdFormActionState, formData: FormData) => {
      const result = await updateHouseholdAction(prevState, formData)
      if (result.successMessage) {
        toast.success(result.successMessage)
        setOpen(false)
        router.refresh()
      }
      return result
    },
    INITIAL_STATE
  )

  const fieldError = (name: string) => state.fieldErrors?.[name]?.[0]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={buttonVariant} size={buttonSize}>
            <PencilIcon data-icon="inline-start" />
            {buttonLabel}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ubah Data Kartu Keluarga</DialogTitle>
          <DialogDescription>
            Perbarui nomor KK, alamat, status hunian, atau kepala keluarga untuk
            Kartu Keluarga ini.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="householdId" value={household.id} />

          {state.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle px-3 py-2.5 text-xs text-destructive-text"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="hh-kk-number"
              className="text-sm font-medium text-foreground"
            >
              Nomor KK <span className="text-destructive">*</span>
            </label>
            <Input
              id="hh-kk-number"
              name="kkNumber"
              inputMode="numeric"
              maxLength={16}
              defaultValue={household.kkNumber}
              required
              disabled={isPending}
              aria-invalid={Boolean(fieldError("kkNumber")) || undefined}
            />
            {fieldError("kkNumber") && (
              <p className="text-xs text-destructive-text">
                {fieldError("kkNumber")}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="hh-block-unit"
                className="text-sm font-medium text-foreground"
              >
                Blok / Nomor Rumah
              </label>
              <Input
                id="hh-block-unit"
                name="blockUnit"
                placeholder="Mis. Blok A-04"
                defaultValue={household.blockUnit ?? ""}
                disabled={isPending}
                aria-invalid={Boolean(fieldError("blockUnit")) || undefined}
              />
              {fieldError("blockUnit") && (
                <p className="text-xs text-destructive-text">
                  {fieldError("blockUnit")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="hh-residence-status"
                className="text-sm font-medium text-foreground"
              >
                Status Hunian <span className="text-destructive">*</span>
              </label>
              <select
                id="hh-residence-status"
                name="residenceStatus"
                defaultValue={household.residenceStatus}
                disabled={isPending}
                className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted/60"
              >
                {Object.entries(STAY_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="hh-address"
              className="text-sm font-medium text-foreground"
            >
              Alamat Lengkap <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="hh-address"
              name="address"
              rows={2}
              defaultValue={household.address}
              required
              disabled={isPending}
              aria-invalid={Boolean(fieldError("address")) || undefined}
            />
            {fieldError("address") && (
              <p className="text-xs text-destructive-text">
                {fieldError("address")}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="hh-head-resident"
                className="text-sm font-medium text-foreground"
              >
                Kepala Keluarga
              </label>
              <select
                id="hh-head-resident"
                name="headResidentId"
                defaultValue={household.headResidentId ?? ""}
                disabled={isPending}
                className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted/60"
              >
                <option value="">-- Belum ditetapkan --</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </select>
              {fieldError("headResidentId") && (
                <p className="text-xs text-destructive-text">
                  {fieldError("headResidentId")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="hh-status"
                className="text-sm font-medium text-foreground"
              >
                Status KK <span className="text-destructive">*</span>
              </label>
              <select
                id="hh-status"
                name="status"
                defaultValue={household.status}
                disabled={isPending}
                className="h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted/60"
              >
                {Object.entries(HOUSEHOLD_STATUS_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Batal
            </Button>
            <Button type="submit" loading={isPending}>
              {isPending ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
