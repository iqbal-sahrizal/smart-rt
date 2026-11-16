import { Suspense } from "react"
import { connection } from "next/server"
import { redirect } from "next/navigation"

import { AuthGuardFallback } from "@/components/auth/auth-guard-fallback"
import { WorkspaceSelector } from "@/components/auth/workspace-selector"
import { requireAuthenticatedUser } from "@/lib/auth/guards"

async function SelectTenantGate({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await connection()
  const ctx = await requireAuthenticatedUser()

  if (ctx.workspaceOptions.length === 0) {
    redirect("/no-access")
  }

  if (ctx.workspaceOptions.length === 1) {
    redirect(ctx.workspaceOptions[0].href)
  }

  const params = await searchParams

  return <WorkspaceSelector ctx={ctx} errorCode={params.error ?? null} />
}

export default function SelectTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  return (
    <Suspense fallback={<AuthGuardFallback />}>
      <SelectTenantGate searchParams={searchParams} />
    </Suspense>
  )
}

