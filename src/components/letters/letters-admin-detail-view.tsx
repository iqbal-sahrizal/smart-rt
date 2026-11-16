"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  FileCheck2Icon,
  FileUpIcon,
  InfoIcon,
  LockIcon,
  MessageSquareIcon,
  TagIcon,
  UserIcon,
} from "lucide-react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { LetterDocumentViewer } from "@/components/letters/letter-document-viewer"
import { LetterIssueDialog } from "@/components/letters/letter-issue-dialog"
import { LetterReviewDialog } from "@/components/letters/letter-review-dialog"
import { LetterOfficialHeader } from "@/components/letters/letter-official-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { RoleCode } from "@/lib/auth/types"
import {
  formatLetterDateTime,
  getAllowedReviewDecisions,
  getLetterRequestCode,
  getLetterRequestStatusBadgeVariant,
  getLetterRequestStatusLabel,
  getLetterReviewActionMeta,
  getLetterRoleBannerNotice,
  getLetterStatusExplanation,
} from "@/lib/letters/formatters"
import { useAdminLetterRequestDetail } from "@/lib/letters/hooks"
import type {
  LetterRequestDetail,
  LetterReviewDecision,
} from "@/lib/letters/types"

interface LettersAdminDetailViewProps {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  requestId: string
  initialDetail: LetterRequestDetail
}

export function LettersAdminDetailView({
  tenantId,
  actorKey,
  roles,
  requestId,
  initialDetail,
}: LettersAdminDetailViewProps) {
  const detailQuery = useAdminLetterRequestDetail({
    tenantId,
    actorKey,
    requestId,
    initialData: initialDetail,
  })

  const detail = detailQuery.data ?? initialDetail
  const { request, letterType, permissions } = detail

  const [pendingDecision, setPendingDecision] =
    React.useState<LetterReviewDecision | null>(null)
  const [reviewDialogOpen, setReviewDialogOpen] = React.useState(false)
  const [issueDialogOpen, setIssueDialogOpen] = React.useState(false)

  const allowedDecisions = permissions.canReview
    ? getAllowedReviewDecisions(request.status)
    : []

  const roleNotice = getLetterRoleBannerNotice(roles)
  const requiredDocs = letterType?.requiredDocuments ?? []

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/surat" />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Daftar Surat</span>
          </Button>
        </div>

        <PageHeader
          title={`${request.letterTypeName} (${request.letterNumber ?? getLetterRequestCode(request.id)})`}
          description={`Diajukan oleh ${request.residentName}${request.residentUnitLabel ? ` (${request.residentUnitLabel})` : ""} pada ${formatLetterDateTime(request.createdAt)}`}
          actions={
            !permissions.isMetadataOnly &&
            (allowedDecisions.length > 0 || permissions.canIssue) ? (
              <div className="flex flex-wrap items-center gap-2">
                {allowedDecisions.map((decision) => {
                  const meta = getLetterReviewActionMeta(decision)
                  return (
                    <Button
                      key={decision}
                      type="button"
                      variant={meta.buttonVariant}
                      size="sm"
                      onClick={() => {
                        setPendingDecision(decision)
                        setReviewDialogOpen(true)
                      }}
                    >
                      {meta.buttonLabel}
                    </Button>
                  )
                })}

                {permissions.canIssue && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setIssueDialogOpen(true)}
                  >
                    <FileUpIcon className="size-4" />
                    <span>Terbitkan Surat (PDF)</span>
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={getLetterRequestStatusBadgeVariant(request.status)}
            size="sm"
          >
            {getLetterRequestStatusLabel(request.status)}
          </Badge>
          <Badge variant="outline" size="sm">
            {request.letterTypeCode}
          </Badge>
          {request.letterNumber && (
            <Badge variant="success" size="sm">
              Nomor: {request.letterNumber}
            </Badge>
          )}
        </div>
      </div>

      {roleNotice && (
        <div
          role="status"
          data-testid="letters-admin-detail-role-notice"
          className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-subtle/40 px-4 py-3 text-sm text-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="space-y-0.5">
            <p className="font-medium">{roleNotice.title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {roleNotice.description}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        {/* Main Column */}
        <div className="space-y-[var(--space-6)] lg:col-span-2">
          {/* Purpose Card (Hidden / Restricted for Pengurus metadata-only) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareIcon className="size-4 text-muted-foreground" />
                <span>Keperluan Pengajuan Surat</span>
              </CardTitle>
              <CardDescription>
                {getLetterStatusExplanation(request.status)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {permissions.isMetadataOnly ? (
                <div
                  data-testid="letter-purpose-restricted"
                  className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
                >
                  <LockIcon className="mt-0.5 size-4 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    Detail keperluan pribadi pemohon tidak ditampilkan untuk
                    role Pengurus.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-surface-subtle/40 p-4 text-sm whitespace-pre-wrap text-foreground">
                  {request.purpose}
                </div>
              )}

              {request.adminNotes && (
                <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-sm">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Catatan Pengelola
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-foreground">
                    {request.adminNotes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Official Letterhead */}
          <LetterOfficialHeader
            letterTitle={request.letterTypeName}
            letterNumber={request.letterNumber}
          />

          {/* Private Documents Section (Never fetches proxy when isMetadataOnly) */}
          <LetterDocumentViewer
            tenantId={tenantId}
            request={request}
            permissions={permissions}
          />
        </div>

        {/* Sidebar Metadata & Checklist */}
        <div className="space-y-[var(--space-6)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informasi Permohonan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3.5 text-sm">
              <div className="flex items-start gap-2.5">
                <UserIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Pemohon</p>
                  <p className="font-medium text-foreground">
                    {request.residentName}
                  </p>
                  {request.residentUnitLabel && (
                    <p className="text-xs text-muted-foreground">
                      {request.residentUnitLabel}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <TagIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Jenis Surat</p>
                  <p className="font-medium text-foreground">
                    {request.letterTypeName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Kode: {request.letterTypeCode}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <div>
                    <p className="text-xs text-muted-foreground">Diajukan</p>
                    <p className="font-medium text-foreground">
                      {formatLetterDateTime(request.createdAt)}
                    </p>
                  </div>
                  {request.reviewedAt && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Terakhir Ditinjau
                        {request.reviewedByLabel
                          ? ` (${request.reviewedByLabel})`
                          : ""}
                      </p>
                      <p className="font-medium text-foreground">
                        {formatLetterDateTime(request.reviewedAt)}
                      </p>
                    </div>
                  )}
                  {request.issuedAt && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Diterbitkan
                      </p>
                      <p className="font-medium text-foreground">
                        {formatLetterDateTime(request.issuedAt)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {request.letterNumber && (
                <div className="flex items-start gap-2.5">
                  <FileCheck2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Nomor Surat Resmi
                    </p>
                    <p className="font-semibold text-foreground">
                      {request.letterNumber}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckSquareIcon className="size-4 text-muted-foreground" />
                <span>Syarat Dokumen Jenis Surat</span>
              </CardTitle>
              <CardDescription>
                Daftar persyaratan standar untuk {request.letterTypeName}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {requiredDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Tidak ada daftar syarat dokumen khusus yang ditetapkan.
                </p>
              ) : (
                <ul className="space-y-2 text-sm text-foreground">
                  {requiredDocs.map((docLabel, idx) => (
                    <li
                      key={`${docLabel}-${idx}`}
                      className="flex items-start gap-2"
                    >
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{docLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {!permissions.isMetadataOnly && (
        <>
          <LetterReviewDialog
            tenantId={tenantId}
            requestId={request.id}
            decision={pendingDecision}
            open={reviewDialogOpen}
            onOpenChange={(nextOpen) => {
              setReviewDialogOpen(nextOpen)
              if (!nextOpen) setPendingDecision(null)
            }}
          />

          <LetterIssueDialog
            tenantId={tenantId}
            requestId={request.id}
            residentName={request.residentName}
            letterTypeName={request.letterTypeName}
            open={issueDialogOpen}
            onOpenChange={setIssueDialogOpen}
          />
        </>
      )}
    </PageContainer>
  )
}

