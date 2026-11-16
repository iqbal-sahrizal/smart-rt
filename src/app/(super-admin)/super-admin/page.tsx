import { Suspense } from "react"
import { Building2Icon, ShieldCheckIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { requireSuperAdminContext } from "@/lib/auth/guards"
import { createClient } from "@/lib/supabase/server"

interface TenantOverviewRow {
  id: string
  code: string
  name: string
  rt_number: string
  rw_number: string
  status: string
}

async function SuperAdminConsoleContent() {
  const ctx = await requireSuperAdminContext()
  const supabase = await createClient()

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, code, name, rt_number, rw_number, status")
    .is("deleted_at", null)
    .order("name", { ascending: true })

  const tenantRows = (tenants ?? []) as TenantOverviewRow[]

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-[var(--space-2)]">
          <ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            Konsol Platform Super Admin
          </h1>
        </div>
        <p className="break-words text-sm text-muted-foreground">
          Sesi terverifikasi untuk{" "}
          <span className="font-medium text-foreground">{ctx.profile.fullName}</span>{" "}
          (<span className="break-all">{ctx.user.email}</span>) dengan hak akses lintas-tenant.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-[var(--space-2)]">
            <Building2Icon className="size-4 text-primary" aria-hidden="true" />
            Daftar Tenant Terdaftar ({tenantRows.length})
          </CardTitle>
          <CardDescription>
            Data dibaca langsung menggunakan session authenticated dan policy RLS{" "}
            <code>is_super_admin()</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tenantRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada tenant RT/RW aktif yang tercatat.
            </p>
          ) : (
            <div className="grid gap-[var(--space-3)] sm:grid-cols-2 lg:grid-cols-3">
              {tenantRows.map((tenant) => (
                <div
                  key={tenant.id}
                  className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-surface-subtle p-[var(--space-3)]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {tenant.name}
                      </span>
                      <Badge
                        variant={tenant.status === "active" ? "success" : "warning"}
                        size="sm"
                      >
                        {tenant.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      RT {tenant.rt_number} / RW {tenant.rw_number} • {tenant.code}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function SuperAdminPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <SuperAdminConsoleContent />
    </Suspense>
  )
}

