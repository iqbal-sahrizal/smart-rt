import {
  Building2Icon,
  ChevronRightIcon,
  HomeIcon,
  LogOutIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { logoutAction, selectWorkspaceAction } from "@/app/actions/auth"
import { SmartRtLogo } from "@/components/layout/smart-rt-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { AuthContextData, WorkspaceOption } from "@/lib/auth/types"
import { ROLE_LABELS } from "@/lib/auth/workspace"

function WorkspaceIcon({ type }: { type: WorkspaceOption["type"] }) {
  if (type === "super_admin") {
    return <ShieldCheckIcon className="size-5 text-navy" aria-hidden="true" />
  }
  if (type === "admin") {
    return <Building2Icon className="size-5 text-primary" aria-hidden="true" />
  }
  return <HomeIcon className="size-5 text-accent-text" aria-hidden="true" />
}

export function WorkspaceSelector({
  ctx,
  errorCode,
}: {
  ctx: AuthContextData
  errorCode?: string | null
}) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-[var(--space-4)] py-[var(--space-8)]">
      <div className="w-full max-w-xl">
        <div className="mb-[var(--space-6)] flex items-center justify-between">
          <SmartRtLogo badgeText="Portal" subtitle="Pemilihan Workspace" />
          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOutIcon />
              Keluar
            </Button>
          </form>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">
              Pilih Workspace & Wilayah RT
            </CardTitle>
            <CardDescription>
              Akun <span className="font-medium text-foreground">{ctx.profile.fullName}</span>{" "}
              ({ctx.user.email}) memiliki beberapa akses aktif. Pilih tujuan Anda untuk melanjutkan.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-[var(--space-3)]">
            {errorCode && (
              <div
                role="alert"
                className="rounded-lg border border-destructive-border bg-destructive-subtle px-[var(--space-3)] py-[var(--space-2)] text-xs text-destructive-text"
              >
                {errorCode === "unauthorized"
                  ? "Workspace yang dipilih tidak valid untuk akun Anda."
                  : "Gagal menyimpan pilihan workspace. Silakan coba kembali."}
              </div>
            )}

            {ctx.workspaceOptions.map((option) => {
              const isCurrentWorkspace = ctx.selectedWorkspace?.key === option.key

              return (
                <form key={option.key} action={selectWorkspaceAction}>
                  <input type="hidden" name="workspaceType" value={option.type} />
                  <input
                    type="hidden"
                    name="tenantId"
                    value={option.tenantId ?? ""}
                  />
                  <button
                    type="submit"
                    className="group flex w-full items-center justify-between gap-[var(--space-3)] rounded-lg border border-border bg-surface p-[var(--space-4)] text-left transition-all duration-150 hover:border-primary/40 hover:bg-primary-subtle/30 focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
                  >
                    <div className="flex min-w-0 items-start gap-[var(--space-3)]">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-subtle">
                        <WorkspaceIcon type={option.type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                          <span className="font-medium text-foreground">
                            {option.label}
                          </span>
                          {isCurrentWorkspace && (
                            <Badge variant="info" size="sm">
                              Aktif
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {option.description}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-[var(--space-1-5)]">
                          <Badge variant="outline" size="sm">
                            {option.tenantSubtitle}
                          </Badge>
                          {option.roles.map((role) => (
                            <Badge key={role} variant="secondary" size="sm">
                              {ROLE_LABELS[role]}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    <ChevronRightIcon
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </button>
                </form>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

