import { Suspense } from "react"
import { connection } from "next/server"
import { redirect } from "next/navigation"

import { AuthGuardFallback } from "@/components/auth/auth-guard-fallback"
import { LoginForm } from "@/components/auth/login-form"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getAuthContext } from "@/lib/auth/server"
import { resolveSafeNextPath } from "@/lib/auth/cookies"
import { resolvePostLoginRoute } from "@/lib/auth/workspace"

async function LoginGate({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  await connection()
  const params = await searchParams
  const safeNextPath = resolveSafeNextPath(params.next)

  const ctx = await getAuthContext()
  if (ctx) {
    redirect(
      safeNextPath ??
        resolvePostLoginRoute(ctx.workspaceOptions, ctx.selectedWorkspace)
    )
  }

  const configError = params.error === "config"

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-[var(--space-4)] py-[var(--space-8)]">
      <div className="w-full max-w-md">
        <div className="mb-[var(--space-6)] flex justify-center">
          <SmartRtLogo badgeText="Portal" subtitle="Sistem Manajemen RT / RW" />
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-semibold">
              Masuk ke Smart RT
            </CardTitle>
            <CardDescription>
              Gunakan akun email dan kata sandi yang terdaftar pada RT Anda.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm configError={configError} nextPath={safeNextPath} />
          </CardContent>
        </Card>

        <p className="mt-[var(--space-4)] text-center text-xs text-muted-foreground">
          Akses akun dikelola oleh pengurus RT atau administrator sistem.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  return (
    <Suspense fallback={<AuthGuardFallback />}>
      <LoginGate searchParams={searchParams} />
    </Suspense>
  )
}

