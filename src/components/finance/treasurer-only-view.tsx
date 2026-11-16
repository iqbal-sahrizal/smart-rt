import Link from "next/link"
import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react"

import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export function TreasurerOnlyView({
  title = "Verifikasi Pembayaran",
}: {
  title?: string
}) {
  return (
    <PageContainer>
      <PageHeader
        title={title}
        description="Akses dibatasi khusus untuk peran Bendahara RT."
        actions={
          <Button
            nativeButton={false}
            variant="outline"
            size="sm"
            render={<Link href="/bills" />}
          >
            <ArrowLeftIcon className="size-4" />
            <span>Kembali ke Tagihan</span>
          </Button>
        }
      />

      <Card data-testid="treasurer-only-denied">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlertIcon className="size-5" />
          </div>
          <div className="max-w-md space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              Akses Khusus Bendahara
            </h2>
            <p className="text-sm text-muted-foreground">
              Antrean verifikasi, bukti pembayaran warga, persetujuan, dan
              penolakan pembayaran hanya dapat diakses dan diproses oleh
              pengurus dengan peran Bendahara.
            </p>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

