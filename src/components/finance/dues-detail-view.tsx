import Link from "next/link"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  PencilIcon,
  PlusIcon,
  ReceiptIcon,
} from "lucide-react"

import { DuesDeleteDialog } from "@/components/finance/dues-delete-dialog"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DUES_BILLING_CYCLE_LABELS,
  DUES_TARGET_SCOPE_LABELS,
  formatIdr,
  formatJakartaDateTime,
  type DuesSummary,
} from "@/lib/finance/types"

interface DuesDetailViewProps {
  due: DuesSummary
  canManage: boolean
  canManageBills: boolean
  notice?: "created" | "updated" | "readonly" | null
}

export function DuesDetailView({
  due,
  canManage,
  canManageBills,
  notice = null,
}: DuesDetailViewProps) {
  return (
    <PageContainer>
      <PageHeader
        title={due.name}
        description="Detail konfigurasi tarif dan cakupan iuran RT."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/dues" />}
            >
              <ArrowLeftIcon className="size-4" />
              <span>Kembali</span>
            </Button>
            {canManageBills && due.isActive && (
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link href={`/bills/new?dueId=${due.id}`} />}
              >
                <PlusIcon className="size-4" />
                <span>Terbitkan Tagihan</span>
              </Button>
            )}
            {canManage && (
              <>
                <Button
                  nativeButton={false}
                  variant="secondary"
                  render={<Link href={`/dues/${due.id}/edit`} />}
                  data-testid="edit-dues-btn"
                >
                  <PencilIcon className="size-4" />
                  <span>Ubah</span>
                </Button>
                <DuesDeleteDialog
                  dueId={due.id}
                  dueName={due.name}
                  billCount={due.billCount ?? 0}
                />
              </>
            )}
          </div>
        }
      />

      {notice === "created" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Konfigurasi iuran baru berhasil disimpan.</span>
        </div>
      )}

      {notice === "updated" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>Perubahan konfigurasi iuran berhasil disimpan.</span>
        </div>
      )}

      {notice === "readonly" && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          Peran Anda hanya memiliki akses baca untuk konfigurasi iuran ini.
        </div>
      )}

      <div className="grid gap-[var(--space-6)] lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={due.isActive ? "success" : "outline"}>
                {due.isActive ? "Aktif" : "Nonaktif"}
              </Badge>
              <Badge variant="info">
                {DUES_BILLING_CYCLE_LABELS[due.billingCycle]}
              </Badge>
              <Badge variant="accent">
                {DUES_TARGET_SCOPE_LABELS[due.targetScope]}
              </Badge>
            </div>
            <CardTitle className="pt-2 text-2xl font-semibold tabular-nums">
              {formatIdr(due.amount)}
            </CardTitle>
            <CardDescription>Nominal tarif default</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Keterangan
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {due.description || "Tidak ada keterangan tambahan."}
              </p>
            </div>

            <div className="grid gap-3 border-t border-border pt-4 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <p>Dibuat pada</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {formatJakartaDateTime(due.createdAt)}
                </p>
              </div>
              <div>
                <p>Terakhir diperbarui</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {formatJakartaDateTime(due.updatedAt)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptIcon className="size-4 text-muted-foreground" />
              <span>Keterkaitan Tagihan</span>
            </CardTitle>
            <CardDescription>
              Ringkasan penggunaan pada modul tagihan
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">
                Total Tagihan Terbit
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {due.billCount ?? 0}
              </p>
            </div>

            <Button
              nativeButton={false}
              variant="outline"
              size="sm"
              render={<Link href={`/bills?dueId=${due.id}`} />}
            >
              Lihat Tagihan Terkait
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

