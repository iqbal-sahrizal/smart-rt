import * as React from "react"
import { Suspense } from "react"
import { connection } from "next/server"

import { AuthGuardFallback } from "@/components/auth/auth-guard-fallback"
import { AppShell } from "@/components/layout/app-shell"
import { requireAdminContext } from "@/lib/auth/guards"
import { toAdminShellUserInfo } from "@/lib/auth/workspace"
import { createClient } from "@/lib/supabase/server"

async function getAdminActiveComplaintCount(tenantId: string): Promise<number> {
  try {
    const supabase = await createClient()
    const { count, error } = await supabase
      .from("complaints")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .in("status", ["open", "in_progress"])

    if (error || typeof count !== "number") return 0
    return count
  } catch {
    return 0
  }
}

async function AdminProtectedContent({
  children,
}: {
  children: React.ReactNode
}) {
  await connection()
  const { ctx, tenant } = await requireAdminContext()
  const shellUser = toAdminShellUserInfo(ctx, tenant)
  const activeComplaintCount = await getAdminActiveComplaintCount(
    tenant.tenantId
  )
  const navBadges =
    activeComplaintCount > 0
      ? { "/pengaduan": String(activeComplaintCount) }
      : undefined

  return (
    <AppShell user={shellUser} navBadges={navBadges}>
      {children}
    </AppShell>
  )
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<AuthGuardFallback />}>
      <AdminProtectedContent>{children}</AdminProtectedContent>
    </Suspense>
  )
}

