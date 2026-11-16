import * as React from "react"
import { Suspense } from "react"
import { connection } from "next/server"
import Link from "next/link"
import { ArrowLeftRightIcon, LogOutIcon } from "lucide-react"

import { logoutAction } from "@/app/actions/auth"
import { AuthGuardFallback } from "@/components/auth/auth-guard-fallback"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { requireSuperAdminContext } from "@/lib/auth/guards"
import { toSuperAdminShellUserInfo } from "@/lib/auth/workspace"

async function SuperAdminProtectedContent({
  children,
}: {
  children: React.ReactNode
}) {
  await connection()
  const ctx = await requireSuperAdminContext()
  const shellUser = toSuperAdminShellUserInfo(ctx)

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-surface/95 backdrop-blur-xs">
        <div className="mx-auto flex h-[var(--size-topbar)] w-full max-w-[var(--container-lg)] items-center justify-between gap-[var(--space-2)] px-[var(--space-3)] sm:gap-[var(--space-4)] sm:px-[var(--space-6)]">
          <Link
            href="/super-admin"
            className="min-w-0 shrink rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
          >
            <SmartRtLogo
              badgeText="Super Admin"
              subtitle="Platform Global"
            />
          </Link>

          <div className="flex shrink-0 items-center gap-[var(--space-1-5)] sm:gap-[var(--space-2)]">
            {shellUser.hasMultipleWorkspaces && (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/select-tenant" />}
              >
                <ArrowLeftRightIcon />
                <span className="hidden sm:inline">Ganti Workspace</span>
              </Button>
            )}

            <div className="flex items-center gap-[var(--space-2)] rounded-full border border-border bg-surface-subtle px-[var(--space-2-5)] py-1">
              <Avatar size="sm">
                <AvatarFallback className="bg-navy text-[11px] font-medium text-navy-foreground">
                  {shellUser.initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden flex-col text-left sm:flex">
                <span className="text-xs leading-none font-medium text-foreground">
                  {shellUser.fullName}
                </span>
                <span className="mt-0.5 text-[11px] leading-none text-muted-foreground">
                  {shellUser.email ?? "Super Admin"}
                </span>
              </div>
            </div>

            <form action={logoutAction}>
              <Button type="submit" variant="destructive" size="sm">
                <LogOutIcon />
                <span className="hidden sm:inline">Keluar</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[var(--container-lg)] flex-1 px-[var(--space-4)] py-[var(--space-6)] sm:px-[var(--space-6)]">
        {children}
      </main>
    </div>
  )
}

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<AuthGuardFallback />}>
      <SuperAdminProtectedContent>{children}</SuperAdminProtectedContent>
    </Suspense>
  )
}

