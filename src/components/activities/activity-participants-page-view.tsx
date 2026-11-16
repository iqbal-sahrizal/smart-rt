"use client"

import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"

import { ActivityParticipantsPanel } from "@/components/activities/activity-participants-panel"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import type { RoleCode } from "@/lib/auth/types"
import type { EligibleActivityResidentOption } from "@/lib/activities/admin-candidates"
import {
  formatActivityDateTimeRange,
  formatActivityStatusLabel,
} from "@/lib/activities/formatters"
import type {
  ActivityDetail,
  ActivityParticipantsPageResult,
} from "@/lib/activities/types"

export function ActivityParticipantsPageView({
  tenantId,
  actorKey,
  roles,
  detail,
  initialParticipants,
  initialParticipantsError,
  eligibleResidents,
}: {
  tenantId: string
  actorKey: string
  roles: readonly RoleCode[]
  detail: ActivityDetail
  initialParticipants: ActivityParticipantsPageResult | null
  initialParticipantsError?: string | null
  eligibleResidents: readonly EligibleActivityResidentOption[]
}) {
  void roles
  const { activity, permissions } = detail

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title={`Peserta — ${activity.title}`}
        description={`${formatActivityDateTimeRange(
          activity.startAt,
          activity.endAt
        )} · Status: ${formatActivityStatusLabel(activity.status)}`}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/kegiatan/${activity.id}`} />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Detail</span>
          </Button>
        }
      />

      <ActivityParticipantsPanel
        tenantId={tenantId}
        actorKey={actorKey}
        activityId={activity.id}
        maxParticipants={activity.maxParticipants}
        activeParticipantCount={activity.activeParticipantCount}
        permissions={permissions}
        eligibleResidents={eligibleResidents}
        initialData={initialParticipants}
        initialError={initialParticipantsError}
      />
    </PageContainer>
  )
}

