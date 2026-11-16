import * as React from "react"
import { Suspense } from "react"
import { connection } from "next/server"

import { AuthGuardFallback } from "@/components/auth/auth-guard-fallback"
import { ResidentShell } from "@/components/resident/resident-shell"
import { requireResidentContext } from "@/lib/auth/guards"
import { toResidentShellUserInfo } from "@/lib/auth/workspace"

async function ResidentProtectedContent({
  children,
}: {
  children: React.ReactNode
}) {
  await connection()
  const { ctx, tenant } = await requireResidentContext()
  const shellUser = toResidentShellUserInfo(ctx, tenant)

  return <ResidentShell user={shellUser}>{children}</ResidentShell>
}

export default function ResidentLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<AuthGuardFallback />}>
      <ResidentProtectedContent>{children}</ResidentProtectedContent>
    </Suspense>
  )
}

