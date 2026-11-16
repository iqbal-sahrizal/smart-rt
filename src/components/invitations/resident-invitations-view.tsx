"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  MailIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  UserPlusIcon,
  XCircleIcon,
} from "lucide-react"

import {
  createResidentInvitationAction,
  resendResidentInvitationAction,
  revokeResidentInvitationAction,
} from "@/app/actions/invitations"
import { ActivationLinkBanner } from "@/components/invitations/activation-link-banner"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  INVITATION_STATUS_LABELS,
  getInvitationStatusBadgeVariant,
  type EligibleResidentForInvitation,
  type InvitationActionState,
  type InvitationStatus,
  type ResidentInvitationItem,
} from "@/lib/invitations/types"

const INITIAL_ACTION_STATE: InvitationActionState = {
  error: null,
}

function formatDateTimeId(iso: string | null | undefined): string {
  if (!iso) return "-"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  })
}

interface ResidentInvitationsViewProps {
  tenantName: string
  items: ResidentInvitationItem[]
  eligibleResidents: EligibleResidentForInvitation[]
  counts: Record<"all" | InvitationStatus, number>
  filters: {
    status: string
    search: string
  }
  error: string | null
}

const STATUS_TABS: Array<{ key: "all" | InvitationStatus; label: string }> = [
  { key: "all", label: "Semua" },
  { key: "pending", label: "Menunggu" },
  { key: "redeemed", label: "Sudah Aktif" },
  { key: "expired", label: "Kedaluwarsa" },
  { key: "revoked", label: "Dibatalkan" },
]

export function ResidentInvitationsView({
  tenantName,
  items,
  eligibleResidents,
  counts,
  filters,
  error,
}: ResidentInvitationsViewProps) {
  const router = useRouter()
  const [searchTerm, setSearchTerm] = React.useState(filters.search)
  const [selectedResidentId, setSelectedResidentId] = React.useState(
    eligibleResidents[0]?.id ?? ""
  )
  const [inviteEmail, setInviteEmail] = React.useState("")

  const [createState, createAction, isCreating] = React.useActionState(
    createResidentInvitationAction,
    INITIAL_ACTION_STATE
  )
  const [resendState, resendAction, isResending] = React.useActionState(
    resendResidentInvitationAction,
    INITIAL_ACTION_STATE
  )
  const [revokeState, revokeAction, isRevoking] = React.useActionState(
    revokeResidentInvitationAction,
    INITIAL_ACTION_STATE
  )

  const effectiveSelectedResidentId = eligibleResidents.some(
    (r) => r.id === selectedResidentId
  )
    ? selectedResidentId
    : (eligibleResidents[0]?.id ?? "")

  const activeBanner = resendState.activationPath
    ? resendState
    : createState.activationPath
      ? createState
      : null

  const actionError =
    createState.error ?? resendState.error ?? revokeState.error ?? error

  const navigateWithFilters = (nextStatus: string, nextSearch: string) => {
    const params = new URLSearchParams()
    if (nextStatus && nextStatus !== "all") params.set("status", nextStatus)
    if (nextSearch.trim()) params.set("q", nextSearch.trim())
    const qs = params.toString()
    router.push(qs ? `/resident-invitations?${qs}` : "/resident-invitations")
  }

  return (
    <PageContainer>
      <PageHeader
        title="Aktivasi Akun Warga"
        description={`Terbitkan dan kelola undangan aktivasi Portal Warga untuk ${tenantName}.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/residents" />}
          >
            <UserPlusIcon data-icon="inline-start" />
            Lihat Direktori Warga
          </Button>
        }
      />

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Menunggu Aktivasi</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {counts.pending}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sudah Diaktivasi</CardDescription>
            <CardTitle className="text-2xl text-success-text tabular-nums">
              {counts.redeemed}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Kedaluwarsa</CardDescription>
            <CardTitle className="text-2xl text-muted-foreground tabular-nums">
              {counts.expired}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Warga Siap Diundang</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {eligibleResidents.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {activeBanner?.activationPath && (
        <ActivationLinkBanner
          activationPath={activeBanner.activationPath}
          invitedEmail={activeBanner.invitedEmail}
          expiresAt={activeBanner.expiresAt}
        />
      )}

      {revokeState.ok && revokeState.message && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-warning-text"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>{revokeState.message}</span>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive-border bg-destructive-subtle px-4 py-3 text-sm text-destructive-text"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Create New Invitation Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buat Undangan Aktivasi Baru</CardTitle>
          <CardDescription>
            Pilih warga aktif yang belum memiliki akun portal atau undangan aktif,
            lalu masukkan alamat email tujuan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {eligibleResidents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Semua warga aktif sudah terhubung ke akun atau memiliki undangan
              yang sedang menunggu aktivasi.
            </div>
          ) : (
            <form
              action={createAction}
              className="grid gap-4 md:grid-cols-[1.4fr_1.4fr_auto] md:items-end"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="invite-resident-select"
                  className="text-sm font-medium text-foreground"
                >
                  Pilih Warga
                </label>
                <select
                  id="invite-resident-select"
                  name="residentId"
                  value={effectiveSelectedResidentId}
                  onChange={(e) => setSelectedResidentId(e.target.value)}
                  disabled={isCreating}
                  className="flex h-[var(--size-control-md)] w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                >
                  {eligibleResidents.map((res) => (
                    <option key={res.id} value={res.id}>
                      {res.fullName}
                      {res.blockUnit ? ` • ${res.blockUnit}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="invite-email-input"
                  className="text-sm font-medium text-foreground"
                >
                  Email Warga
                </label>
                <div className="relative">
                  <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="invite-email-input"
                    name="email"
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="warga@contoh.id"
                    disabled={isCreating}
                    className="pl-9"
                  />
                </div>
              </div>

              <Button type="submit" loading={isCreating}>
                <SendIcon data-icon="inline-start" />
                Buat Tautan Undangan
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Invitations History & Management */}
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">Daftar Undangan Aktivasi</CardTitle>
              <CardDescription>
                Pantau status aktivasi, masa berlaku token, serta aksi batal atau
                terbit ulang.
              </CardDescription>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                navigateWithFilters(filters.status, searchTerm)
              }}
              className="flex w-full gap-2 md:w-72"
            >
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Cari nama warga atau email..."
                  className="pl-9"
                />
              </div>
              <Button type="submit" variant="outline" size="default">
                Cari
              </Button>
            </form>
          </div>

          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map((tab) => {
              const active = (filters.status || "all") === tab.key
              return (
                <Button
                  key={tab.key}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => navigateWithFilters(tab.key, searchTerm)}
                >
                  {tab.label} ({counts[tab.key]})
                </Button>
              )
            })}
          </div>
        </CardHeader>

        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
              Belum ada undangan aktivasi yang sesuai dengan filter saat ini.
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warga</TableHead>
                      <TableHead>Email Tujuan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Masa Berlaku</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const effStatus = item.effectiveStatus
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Link
                              href={`/residents/${item.residentId}`}
                              className="font-medium text-foreground hover:text-primary hover:underline"
                            >
                              {item.residentName}
                            </Link>
                            {(item.householdBlockUnit || item.householdAddress) && (
                              <p className="text-xs text-muted-foreground">
                                {item.householdBlockUnit ?? item.householdAddress}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm break-all whitespace-normal text-foreground">
                            {item.email}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={getInvitationStatusBadgeVariant(effStatus)}
                            >
                              {INVITATION_STATUS_LABELS[effStatus]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {effStatus === "redeemed" && item.redeemedAt ? (
                              <span>
                                Aktif: {formatDateTimeId(item.redeemedAt)} WIB
                              </span>
                            ) : effStatus === "revoked" && item.revokedAt ? (
                              <span>
                                Dibatalkan: {formatDateTimeId(item.revokedAt)} WIB
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <ClockIcon className="size-3.5" />
                                {formatDateTimeId(item.expiresAt)} WIB
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex flex-wrap justify-end gap-2">
                              {effStatus === "pending" && (
                                <>
                                  <form action={resendAction}>
                                    <input
                                      type="hidden"
                                      name="invitationId"
                                      value={item.id}
                                    />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant="outline"
                                      disabled={isResending || isRevoking}
                                    >
                                      <RefreshCwIcon data-icon="inline-start" />
                                      Terbitkan Ulang
                                    </Button>
                                  </form>
                                  <form action={revokeAction}>
                                    <input
                                      type="hidden"
                                      name="invitationId"
                                      value={item.id}
                                    />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant="destructive"
                                      disabled={isResending || isRevoking}
                                    >
                                      <XCircleIcon data-icon="inline-start" />
                                      Batalkan
                                    </Button>
                                  </form>
                                </>
                              )}
                              {(effStatus === "expired" ||
                                effStatus === "revoked") && (
                                <form action={resendAction}>
                                  <input
                                    type="hidden"
                                    name="invitationId"
                                    value={item.id}
                                  />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant="outline"
                                    disabled={isResending || isRevoking}
                                  >
                                    <RefreshCwIcon data-icon="inline-start" />
                                    Terbitkan Ulang
                                  </Button>
                                </form>
                              )}
                              {effStatus === "redeemed" && (
                                <span className="text-xs text-muted-foreground">
                                  Selesai
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 md:hidden">
                {items.map((item) => {
                  const effStatus = item.effectiveStatus
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle/30 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/residents/${item.residentId}`}
                            className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {item.residentName}
                          </Link>
                          {(item.householdBlockUnit || item.householdAddress) && (
                            <p className="truncate text-xs text-muted-foreground">
                              {item.householdBlockUnit ?? item.householdAddress}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={getInvitationStatusBadgeVariant(effStatus)}
                          size="sm"
                        >
                          {INVITATION_STATUS_LABELS[effStatus]}
                        </Badge>
                      </div>

                      <div className="space-y-1 text-xs">
                        <p className="break-all text-foreground">{item.email}</p>
                        <p className="text-muted-foreground">
                          {effStatus === "redeemed" && item.redeemedAt
                            ? `Aktif: ${formatDateTimeId(item.redeemedAt)} WIB`
                            : effStatus === "revoked" && item.revokedAt
                              ? `Dibatalkan: ${formatDateTimeId(item.revokedAt)} WIB`
                              : `Berlaku s/d: ${formatDateTimeId(item.expiresAt)} WIB`}
                        </p>
                      </div>

                      {effStatus !== "redeemed" && (
                        <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-2.5">
                          {(effStatus === "pending" ||
                            effStatus === "expired" ||
                            effStatus === "revoked") && (
                            <form action={resendAction} className="flex-1">
                              <input
                                type="hidden"
                                name="invitationId"
                                value={item.id}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                variant="outline"
                                disabled={isResending || isRevoking}
                                className="w-full"
                              >
                                <RefreshCwIcon data-icon="inline-start" />
                                Terbitkan Ulang
                              </Button>
                            </form>
                          )}
                          {effStatus === "pending" && (
                            <form action={revokeAction} className="flex-1">
                              <input
                                type="hidden"
                                name="invitationId"
                                value={item.id}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                variant="destructive"
                                disabled={isResending || isRevoking}
                                className="w-full"
                              >
                                <XCircleIcon data-icon="inline-start" />
                                Batalkan
                              </Button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
