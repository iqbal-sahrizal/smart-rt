import { Suspense } from "react"
import { connection } from "next/server"
import Link from "next/link"
import { redirect } from "next/navigation"
import { LogOutIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react"

import { logoutAction } from "@/app/actions/auth"
import { AuthGuardFallback } from "@/components/auth/auth-guard-fallback"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAuthenticatedUser } from "@/lib/auth/guards"
import { resolvePostLoginRoute } from "@/lib/auth/workspace"

async function NoAccessGate() {
  await connection()
  const ctx = await requireAuthenticatedUser()

  if (ctx.workspaceOptions.length > 0) {
    redirect(resolvePostLoginRoute(ctx.workspaceOptions, ctx.selectedWorkspace))
  }

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-[var(--space-4)] py-[var(--space-8)]">
      <div className="w-full max-w-md">
        <div className="mb-[var(--space-6)] flex justify-center">
          <SmartRtLogo badgeText="Portal" subtitle="Status Keanggotaan" />
        </div>

        <Card>
          <CardHeader className="items-center text-center">
            <div className="mb-[var(--space-2)] flex size-12 items-center justify-center rounded-full bg-warning-subtle text-warning-text">
              <ShieldAlertIcon className="size-6" aria-hidden="true" />
            </div>
            <CardTitle className="text-lg font-semibold">
              Belum Ada Akses RT Aktif
            </CardTitle>
            <CardDescription>
              Akun <span className="font-medium text-foreground">{ctx.user.email}</span>{" "}
              berhasil masuk, namun belum memiliki keanggotaan RT atau role aktif saat ini.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-[var(--space-3)]">
            <div className="rounded-lg border border-border bg-surface-subtle p-[var(--space-3)] text-xs text-muted-foreground">
              Hubungi Ketua RT atau pengurus RT Anda agar akun ditautkan sebagai anggota aktif dengan role yang sesuai.
            </div>

            <div className="flex flex-col gap-[var(--space-2)] sm:flex-row">
              <Button
                variant="outline"
                nativeButton={false}
                className="flex-1"
                render={<Link href="/no-access" />}
              >
                <RefreshCwIcon />
                Periksa Ulang
              </Button>
              <form action={logoutAction} className="flex-1">
                <Button type="submit" variant="destructive" className="w-full">
                  <LogOutIcon />
                  Keluar
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function NoAccessPage() {
  return (
    <Suspense fallback={<AuthGuardFallback />}>
      <NoAccessGate />
    </Suspense>
  )
}
