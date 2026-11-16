"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  KeyRoundIcon,
  MailIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldAlertIcon,
  XCircleIcon,
} from "lucide-react"

import {
  createResidentInvitationAction,
  resendResidentInvitationAction,
  revokeResidentInvitationAction,
} from "@/app/actions/invitations"
import { ActivationLinkBanner } from "@/components/invitations/activation-link-banner"
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
import { Input } from "@/components/ui/input"
import {
  INVITATION_STATUS_LABELS,
  getInvitationStatusBadgeVariant,
  type InvitationActionState,
  type ResidentAccountLinkSummary,
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

interface ResidentInvitationPanelProps {
  residentId: string
  residentName: string
  residencyStatus: string
  canManage: boolean
  linkSummary: ResidentAccountLinkSummary
}

export function ResidentInvitationPanel({
  residentId,
  residentName,
  residencyStatus,
  canManage,
  linkSummary,
}: ResidentInvitationPanelProps) {
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

  const [emailInput, setEmailInput] = React.useState(
    linkSummary.latestInvitation?.email ?? ""
  )

  const latest = linkSummary.latestInvitation
  const latestStatus = latest?.effectiveStatus ?? null
  const activeBanner = resendState.activationPath
    ? resendState
    : createState.activationPath
      ? createState
      : null

  const errorBanner =
    createState.error ?? resendState.error ?? revokeState.error ?? null

  return (
    <Card data-testid="resident-invitation-panel">
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRoundIcon className="size-4 text-primary" />
          <CardTitle className="text-base">Aktivasi Akun Portal Warga</CardTitle>
        </div>
        <CardDescription>
          Kelola undangan login portal mandiri untuk {residentName} (role Warga).
        </CardDescription>
        <CardAction>
          {linkSummary.isLinked ? (
            <Badge variant="success">Akun Aktif Terhubung</Badge>
          ) : latest ? (
            <Badge variant={getInvitationStatusBadgeVariant(latest.effectiveStatus)}>
              {INVITATION_STATUS_LABELS[latest.effectiveStatus]}
            </Badge>
          ) : (
            <Badge variant="outline">Belum Diundang</Badge>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 text-sm">
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
            className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning-subtle px-3.5 py-2.5 text-xs text-warning-text"
          >
            <CheckCircle2Icon className="size-4 shrink-0" />
            <span>{revokeState.message}</span>
          </div>
        )}

        {errorBanner && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive-border bg-destructive-subtle px-3.5 py-2.5 text-xs text-destructive-text"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
        )}

        {linkSummary.isLinked ? (
          <div className="flex flex-col gap-2 rounded-lg border border-success-border/60 bg-success-subtle/40 p-4 text-xs">
            <div className="flex items-center gap-2 font-semibold text-success-text">
              <CheckCircle2Icon className="size-4 shrink-0" />
              <span>Warga sudah memiliki akun portal aktif</span>
            </div>
            <p className="text-muted-foreground">
              Akun warga telah terhubung sebagai anggota RT (status:{" "}
              <strong className="text-foreground">
                {linkSummary.memberStatus ?? "active"}
              </strong>
              )
              {linkSummary.joinedAt
                ? ` sejak ${formatDateTimeId(linkSummary.joinedAt)} WIB`
                : ""}
              . Untuk mencegah kepemilikan ganda, undangan baru dinonaktifkan.
            </p>
            {latest?.email && (
              <p className="text-muted-foreground">
                Email aktivasi tercatat:{" "}
                <strong className="text-foreground">{latest.email}</strong>
              </p>
            )}
          </div>
        ) : !canManage ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              Hanya Ketua RT atau Sekretaris yang dapat membuat, membatalkan,
              atau menerbitkan ulang undangan aktivasi akun warga.
            </span>
          </div>
        ) : residencyStatus !== "aktif" ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
            Warga berstatus <strong className="text-foreground">{residencyStatus}</strong>{" "}
            tidak dapat diundang ke Portal Warga. Ubah status kependudukan menjadi{" "}
            <strong className="text-foreground">Aktif</strong> terlebih dahulu jika
            diperlukan.
          </div>
        ) : latest && latestStatus === "pending" ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle p-4">
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Email Tujuan</span>
                <p className="mt-0.5 font-medium text-foreground">
                  {latest.email}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Berlaku Hingga</span>
                <p className="mt-0.5 flex items-center gap-1 font-medium text-foreground">
                  <ClockIcon className="size-3.5 text-muted-foreground" />
                  {formatDateTimeId(latest.expiresAt)} WIB
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <form action={resendAction} className="inline-flex">
                <input type="hidden" name="invitationId" value={latest.id} />
                <input type="hidden" name="email" value={latest.email} />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  loading={isResending}
                  disabled={isRevoking}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Terbitkan Ulang Tautan
                </Button>
              </form>

              <form action={revokeAction} className="inline-flex">
                <input type="hidden" name="invitationId" value={latest.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  loading={isRevoking}
                  disabled={isResending}
                >
                  <XCircleIcon data-icon="inline-start" />
                  Batalkan Undangan
                </Button>
              </form>
            </div>
          </div>
        ) : latest && (latestStatus === "expired" || latestStatus === "revoked") ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle p-4">
            <div className="text-xs text-muted-foreground">
              Undangan terakhir ke{" "}
              <strong className="text-foreground">{latest.email}</strong> berstatus{" "}
              <strong className="text-foreground">
                {INVITATION_STATUS_LABELS[latestStatus]}
              </strong>
              . Anda dapat menerbitkan undangan baru dengan email yang sama atau
              memperbarui alamat emailnya.
            </div>
            <form
              action={resendAction}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <input type="hidden" name="invitationId" value={latest.id} />
              <div className="flex-1 space-y-1">
                <label
                  htmlFor={`resend-email-${residentId}`}
                  className="text-xs font-medium text-foreground"
                >
                  Email Undangan
                </label>
                <div className="relative">
                  <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={`resend-email-${residentId}`}
                    name="email"
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="warga@contoh.id"
                    disabled={isResending}
                    className="pl-8"
                  />
                </div>
              </div>
              <Button type="submit" size="sm" loading={isResending}>
                <RefreshCwIcon data-icon="inline-start" />
                Terbitkan Ulang Undangan
              </Button>
            </form>
          </div>
        ) : (
          <form
            action={createAction}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle p-4"
          >
            <input type="hidden" name="residentId" value={residentId} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <label
                  htmlFor={`invite-email-${residentId}`}
                  className="text-xs font-medium text-foreground"
                >
                  Email Tujuan Undangan
                </label>
                <div className="relative">
                  <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={`invite-email-${residentId}`}
                    name="email"
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="nama.warga@contoh.id"
                    disabled={isCreating}
                    className="pl-8"
                  />
                </div>
                {createState.fieldErrors?.email?.[0] && (
                  <p className="text-xs text-destructive-text">
                    {createState.fieldErrors.email[0]}
                  </p>
                )}
              </div>
              <Button type="submit" size="sm" loading={isCreating}>
                <SendIcon data-icon="inline-start" />
                Buat Undangan Aktivasi
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tautan aktivasi berlaku selama 7 hari, hanya dapat dipakai satu kali,
              dan hanya memberikan peran <strong>Warga</strong> untuk RT ini.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

