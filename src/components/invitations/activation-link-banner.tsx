"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckCircle2Icon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"

interface ActivationLinkBannerProps {
  activationPath: string
  activationUrl?: string | null
  invitedEmail?: string | null
  expiresAt?: string | null
  title?: string
}

function formatDateTimeId(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  })
}

export function ActivationLinkBanner({
  activationPath,
  activationUrl,
  invitedEmail,
  expiresAt,
  title = "Tautan Aktivasi Satu Kali Siap Dikirim",
}: ActivationLinkBannerProps) {
  const [copied, setCopied] = React.useState(false)
  const formattedExpiry = formatDateTimeId(expiresAt)

  const handleCopy = async () => {
    try {
      const fullUrl =
        activationUrl && activationUrl.startsWith("https://")
          ? activationUrl
          : `${window.location.origin}${activationPath}`
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      role="status"
      data-testid="activation-link-banner"
      className="flex flex-col gap-3 rounded-lg border border-success-border bg-success-subtle p-4 text-sm text-success-text"
    >
      <div className="flex items-start gap-2.5">
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">{title}</p>
          <p className="text-xs leading-relaxed">
            {invitedEmail ? (
              <>
                Undangan ditujukan untuk{" "}
                <strong className="font-semibold">{invitedEmail}</strong>.{" "}
              </>
            ) : null}
            Demi keamanan, token hanya ditampilkan sekali dan tidak disimpan
            dalam bentuk teks biasa.
            {formattedExpiry
              ? ` Berlaku hingga ${formattedExpiry} WIB.`
              : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-success-border/60 bg-surface px-3 py-2 text-xs text-foreground sm:flex-row sm:items-center sm:justify-between">
        <code className="truncate font-mono select-all" data-testid="activation-link-value">
          {activationPath}
        </code>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <CheckIcon data-icon="inline-start" />
                Tersalin
              </>
            ) : (
              <>
                <CopyIcon data-icon="inline-start" />
                Salin Tautan
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href={activationPath} target="_blank" />}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Buka
          </Button>
        </div>
      </div>
    </div>
  )
}
