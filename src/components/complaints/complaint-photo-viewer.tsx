"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  ExternalLinkIcon,
  ImageIcon,
  ImageOffIcon,
  LockIcon,
  RefreshCwIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getComplaintPhotoPresentation } from "@/lib/complaints/formatters"
import type { ComplaintDetail } from "@/lib/complaints/types"

interface ComplaintPhotoViewerProps {
  complaint: ComplaintDetail["complaint"]
  permissions: ComplaintDetail["permissions"]
  description?: string
  footer?: React.ReactNode
}

export function ComplaintPhotoViewer({
  complaint,
  permissions,
  description = "Bukti visual yang dilampirkan pelapor (akses privat terautentikasi).",
  footer,
}: ComplaintPhotoViewerProps) {
  const presentation = getComplaintPhotoPresentation({
    complaint,
    permissions,
  })
  const [attempt, setAttempt] = React.useState(0)
  const [imageState, setImageState] = React.useState<{
    url: string
    status: "loaded" | "error"
  } | null>(null)

  const photoUrl =
    presentation.kind === "available"
      ? attempt > 0
        ? `${presentation.photoUrl}?retry=${attempt}`
        : presentation.photoUrl
      : null

  const isLoaded = Boolean(
    photoUrl && imageState?.url === photoUrl && imageState.status === "loaded"
  )
  const hasError = Boolean(
    photoUrl && imageState?.url === photoUrl && imageState.status === "error"
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="size-4 text-muted-foreground" />
            <span>Lampiran Foto</span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>

        {presentation.kind === "available" && !hasError && photoUrl && (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={presentation.photoUrl}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <ExternalLinkIcon className="size-3.5" />
            <span>Buka Foto</span>
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {presentation.kind === "restricted" && (
          <div
            data-testid="complaint-photo-restricted"
            className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
          >
            <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Lampiran Foto Dibatasi
              </p>
              <p className="text-xs leading-relaxed">{presentation.message}</p>
            </div>
          </div>
        )}

        {presentation.kind === "empty" && (
          <div
            data-testid="complaint-photo-empty"
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
          >
            <ImageOffIcon className="size-6 text-muted-foreground/70" />
            <span>{presentation.message}</span>
          </div>
        )}

        {presentation.kind === "available" && photoUrl && (
          <div className="space-y-3">
            {!isLoaded && !hasError && (
              <Skeleton className="h-64 w-full rounded-lg" />
            )}

            {hasError ? (
              <div
                role="alert"
                className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive-subtle/40 px-4 py-8 text-center text-sm text-destructive"
              >
                <AlertCircleIcon className="size-6 shrink-0" />
                <p>
                  Foto pengaduan gagal dimuat. Pastikan koneksi dan sesi aktif,
                  lalu coba muat ulang.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAttempt((prev) => prev + 1)}
                >
                  <RefreshCwIcon className="size-3.5" />
                  <span>Muat Ulang Foto</span>
                </Button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated private route proxy streams binary bytes directly */}
                <img
                  src={photoUrl}
                  alt={`Lampiran foto untuk pengaduan ${complaint.title}`}
                  onLoad={() =>
                    setImageState({ url: photoUrl, status: "loaded" })
                  }
                  onError={() =>
                    setImageState({ url: photoUrl, status: "error" })
                  }
                  className={
                    isLoaded
                      ? "max-h-[440px] w-full object-contain"
                      : "hidden"
                  }
                />
              </div>
            )}
          </div>
        )}

        {footer && (
          <div className="mt-4 border-t border-border pt-4">{footer}</div>
        )}
      </CardContent>
    </Card>
  )
}
