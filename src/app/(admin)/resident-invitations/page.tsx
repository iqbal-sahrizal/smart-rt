import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react"

import { ResidentInvitationsView } from "@/components/invitations/resident-invitations-view"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { ResidentsDirectorySkeleton } from "@/components/residents/resident-skeletons"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireAdminContext } from "@/lib/auth/guards"
import { getAdminResidentInvitations } from "@/lib/invitations/queries"
import { canManageInvitations } from "@/lib/invitations/types"

type ResidentInvitationsSearchParams = Promise<{
  status?: string
  q?: string
}>

async function ResidentInvitationsContent({
  searchParams,
}: {
  searchParams: ResidentInvitationsSearchParams
}) {
  const { tenant } = await requireAdminContext()

  if (!canManageInvitations(tenant.roles)) {
    return (
      <PageContainer>
        <PageHeader
          title="Aktivasi Akun Warga"
          description="Akses dibatasi khusus untuk Ketua RT dan Sekretaris."
          actions={
            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link href="/residents" />}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              <span>Kembali ke Data Warga</span>
            </Button>
          }
        />
        <Card data-testid="invitation-management-denied">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlertIcon className="size-5" />
            </div>
            <div className="max-w-md space-y-1">
              <h2 className="text-base font-semibold text-foreground">
                Akses Terbatas Pengurus Inti
              </h2>
              <p className="text-sm text-muted-foreground">
                Hanya Ketua RT dan Sekretaris yang berwenang menerbitkan,
                mengelola, atau membatalkan undangan aktivasi Portal Warga.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  const resolved = await searchParams
  const status = typeof resolved.status === "string" ? resolved.status : "all"
  const search = typeof resolved.q === "string" ? resolved.q : ""

  const data = await getAdminResidentInvitations({
    tenantId: tenant.tenantId,
    status,
    search,
  })

  return (
    <ResidentInvitationsView
      tenantName={tenant.tenantName}
      items={data.items}
      eligibleResidents={data.eligibleResidents}
      counts={data.counts}
      filters={{ status, search }}
      error={data.error}
    />
  )
}

export default function ResidentInvitationsPage({
  searchParams,
}: {
  searchParams: ResidentInvitationsSearchParams
}) {
  return (
    <Suspense fallback={<ResidentsDirectorySkeleton />}>
      <ResidentInvitationsContent searchParams={searchParams} />
    </Suspense>
  )
}

