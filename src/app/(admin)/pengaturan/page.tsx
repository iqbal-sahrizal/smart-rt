import { connection } from "next/server"
import { notFound } from "next/navigation"
import { InfoIcon } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { TenantIdentityForm } from "@/components/settings/tenant-identity-form"
import { requireAdminContext } from "@/lib/auth/guards"
import { getTenantIdentity } from "@/lib/tenants/queries"

export const metadata = {
  title: "Pengaturan Identitas RT — Smart RT",
  description: "Kelola informasi identitas, wilayah, dan logo Rukun Tetangga.",
}

export default async function TenantSettingsPage() {
  await connection()
  const { tenant } = await requireAdminContext()

  const identity = await getTenantIdentity(tenant.tenantId)
  if (!identity) {
    notFound()
  }

  const canEdit =
    tenant.roles.includes("ketua_rt") || tenant.roles.includes("sekretaris")

  return (
    <PageContainer className="flex flex-col gap-[var(--space-6)]">
      <PageHeader
        title="Pengaturan Lingkungan RT"
        description="Konfigurasi identitas organisasi, alamat wilayah, dan logo resmi RT."
      />

      {!canEdit && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-subtle/30 px-4 py-3 text-sm text-foreground"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="space-y-0.5">
            <p className="font-medium">Akses Hanya Lihat (Read-Only)</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Hanya pengurus dengan peran Ketua RT atau Sekretaris yang dapat
              mengubah identitas dan logo RT.
            </p>
          </div>
        </div>
      )}

      <TenantIdentityForm initialData={identity} canEdit={canEdit} />
    </PageContainer>
  )
}

