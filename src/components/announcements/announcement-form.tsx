"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeftIcon, AlertCircleIcon, SendIcon } from "lucide-react"

import {
  createAnnouncementAction,
  updateAnnouncementAction,
} from "@/app/actions/announcements"
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
  AnnouncementFormActionState,
  AnnouncementStatus,
  AnnouncementTargetType,
  HouseholdTargetOption,
  RoleOption,
} from "@/lib/announcements/types"

interface AnnouncementFormProps {
  mode: "create" | "edit"
  roles: RoleOption[]
  households: HouseholdTargetOption[]
  initialValues?: {
    announcementId: string
    title: string
    content: string
    status: AnnouncementStatus
    targetType: AnnouncementTargetType
    recipientRoleIds: string[]
    recipientHouseholdIds: string[]
  }
}

const INITIAL_ACTION_STATE: AnnouncementFormActionState = {
  error: null,
}

export function AnnouncementForm({
  mode,
  roles,
  households,
  initialValues,
}: AnnouncementFormProps) {
  const actionFn =
    mode === "edit" ? updateAnnouncementAction : createAnnouncementAction

  const [state, formAction, isPending] = React.useActionState(
    actionFn,
    INITIAL_ACTION_STATE
  )

  const [targetType, setTargetType] = React.useState<AnnouncementTargetType>(
    initialValues?.targetType ?? "all"
  )
  const [selectedRoleIds, setSelectedRoleIds] = React.useState<string[]>(
    initialValues?.recipientRoleIds ?? []
  )
  const [selectedHouseholdIds, setSelectedHouseholdIds] = React.useState<
    string[]
  >(initialValues?.recipientHouseholdIds ?? [])

  const toggleSelection = (
    id: string,
    selected: string[],
    setSelected: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setSelected(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id]
    )
  }

  const backHref =
    mode === "edit" && initialValues
      ? `/announcements/${initialValues.announcementId}`
      : "/announcements"

  return (
    <PageContainer>
      <PageHeader
        title={mode === "edit" ? "Ubah Pengumuman" : "Buat Pengumuman Baru"}
        description={
          mode === "edit"
            ? "Perbarui judul, isi pengumuman, status publikasi, atau target penerima."
            : "Susun pengumuman resmi untuk seluruh warga, peran pengurus tertentu, atau Kartu Keluarga tertentu."
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
          <CardTitle className="text-base">Detail Pengumuman</CardTitle>
          <CardDescription>
            Pastikan target audiens dan status publikasi sudah tepat sebelum
            menyimpan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-[var(--space-5)]">
            {mode === "edit" && initialValues && (
              <input
                type="hidden"
                name="announcementId"
                value={initialValues.announcementId}
              />
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
                htmlFor="announcement-title"
                className="text-sm font-medium text-foreground"
              >
                Judul Pengumuman
              </label>
              <Input
                id="announcement-title"
                name="title"
                required
                minLength={3}
                maxLength={180}
                defaultValue={initialValues?.title ?? ""}
                placeholder="Contoh: Jadwal Kerja Bakti Lingkungan RT 05"
                disabled={isPending}
              />
              {state.fieldErrors?.title?.[0] && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.title[0]}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="announcement-content"
                className="text-sm font-medium text-foreground"
              >
                Isi Pengumuman
              </label>
              <textarea
                id="announcement-content"
                name="content"
                required
                minLength={10}
                maxLength={10000}
                rows={7}
                defaultValue={initialValues?.content ?? ""}
                placeholder="Tuliskan informasi lengkap mengenai jadwal, lokasi, ketentuan, dan catatan penting untuk warga..."
                disabled={isPending}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {state.fieldErrors?.content?.[0] && (
                <p className="text-xs text-destructive">
                  {state.fieldErrors.content[0]}
                </p>
              )}
            </div>

            <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <label
                  htmlFor="announcement-status"
                  className="text-sm font-medium text-foreground"
                >
                  Status Publikasi
                </label>
                <select
                  id="announcement-status"
                  name="status"
                  defaultValue={initialValues?.status ?? "draft"}
                  disabled={isPending}
                  className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="draft">Draf (Disimpan internal pengurus)</option>
                  <option value="published">
                    Dipublikasikan (Tampil untuk penerima)
                  </option>
                  <option value="archived">
                    Diarsipkan (Disembunyikan dari warga)
                  </option>
                </select>
                {state.fieldErrors?.status?.[0] && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.status[0]}
                  </p>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <label
                  htmlFor="announcement-target-type"
                  className="text-sm font-medium text-foreground"
                >
                  Target Audiens
                </label>
                <select
                  id="announcement-target-type"
                  name="targetType"
                  value={targetType}
                  onChange={(event) =>
                    setTargetType(event.target.value as AnnouncementTargetType)
                  }
                  disabled={isPending}
                  className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="all">Seluruh Warga RT</option>
                  <option value="role">Peran Tertentu</option>
                  <option value="household">Kartu Keluarga Tertentu</option>
                </select>
                {state.fieldErrors?.targetType?.[0] && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.targetType[0]}
                  </p>
                )}
              </div>
            </div>

            {targetType === "role" && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Pilih Peran Penerima
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hanya anggota RT yang memiliki peran terpilih yang dapat
                    melihat pengumuman ini saat dipublikasikan.
                  </p>
                </div>
                {roles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Data peran tidak tersedia.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {roles.map((role) => {
                      const checked = selectedRoleIds.includes(role.id)
                      return (
                        <label
                          key={role.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            name="recipientRoleIds"
                            value={role.id}
                            checked={checked}
                            disabled={isPending}
                            onChange={() =>
                              toggleSelection(
                                role.id,
                                selectedRoleIds,
                                setSelectedRoleIds
                              )
                            }
                            className="size-4 accent-primary"
                          />
                          <span className="font-medium text-foreground">
                            {role.name}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {state.fieldErrors?.recipientRoleIds?.[0] && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.recipientRoleIds[0]}
                  </p>
                )}
              </div>
            )}

            {targetType === "household" && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Pilih Kartu Keluarga Penerima
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hanya warga yang terhubung dengan Kartu Keluarga terpilih yang
                    dapat melihat pengumuman ini saat dipublikasikan.
                  </p>
                </div>
                {households.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Belum ada Kartu Keluarga aktif pada RT ini.
                  </p>
                ) : (
                  <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {households.map((household) => {
                      const checked = selectedHouseholdIds.includes(
                        household.id
                      )
                      return (
                        <label
                          key={household.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            name="recipientHouseholdIds"
                            value={household.id}
                            checked={checked}
                            disabled={isPending}
                            onChange={() =>
                              toggleSelection(
                                household.id,
                                selectedHouseholdIds,
                                setSelectedHouseholdIds
                              )
                            }
                            className="size-4 accent-primary"
                          />
                          <span className="truncate text-foreground">
                            {household.label}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {state.fieldErrors?.recipientHouseholdIds?.[0] && (
                  <p className="text-xs text-destructive">
                    {state.fieldErrors.recipientHouseholdIds[0]}
                  </p>
                )}
              </div>
            )}

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
                data-testid="submit-announcement-btn"
              >
                <SendIcon className="size-4" />
                <span>
                  {isPending
                    ? "Menyimpan..."
                    : mode === "edit"
                      ? "Simpan Perubahan"
                      : "Simpan Pengumuman"}
                </span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
