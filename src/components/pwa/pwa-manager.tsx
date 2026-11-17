"use client"

import * as React from "react"
import { RefreshCwIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { shouldReloadOnControllerChange } from "@/lib/pwa/sw-policy"

const UPDATE_CHECK_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes
const CHUNK_RECOVERY_STORAGE_KEY = "smart_rt_chunk_recovery_ts"
const CHUNK_RECOVERY_COOLDOWN_MS = 60 * 1000 // 60 seconds

function isChunkLoadFailure(reason: unknown): boolean {
  if (!reason) return false
  const name =
    typeof reason === "object" && "name" in reason
      ? String((reason as { name?: unknown }).name)
      : ""
  const message =
    typeof reason === "object" && "message" in reason
      ? String((reason as { message?: unknown }).message)
      : String(reason)

  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    message.includes("/_next/static/chunks/")
  )
}

export function PwaManager() {
  const [waitingWorker, setWaitingWorker] =
    React.useState<ServiceWorker | null>(null)
  const [chunkSkewDetected, setChunkSkewDetected] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)
  const [isActivating, setIsActivating] = React.useState(false)

  const hasExistingControllerRef = React.useRef(false)
  const userConfirmedUpdateRef = React.useRef(false)
  const alreadyReloadedRef = React.useRef(false)
  const lastUpdateCheckAtRef = React.useRef(0)

  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return
    }

    hasExistingControllerRef.current = Boolean(
      navigator.serviceWorker.controller
    )

    let registrationRef: ServiceWorkerRegistration | null = null
    let isMounted = true

    const attachInstallingListener = (installing: ServiceWorker | null) => {
      if (!installing) return
      installing.addEventListener("statechange", () => {
        if (!isMounted) return
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          hasExistingControllerRef.current = true
          setWaitingWorker(installing)
          setDismissed(false)
        }
      })
    }

    const handleControllerChange = () => {
      if (
        shouldReloadOnControllerChange({
          hasExistingController: hasExistingControllerRef.current,
          userConfirmedUpdate: userConfirmedUpdateRef.current,
          alreadyReloaded: alreadyReloadedRef.current,
        })
      ) {
        alreadyReloadedRef.current = true
        window.location.reload()
      }
    }

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange
    )

    async function registerSw() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        })
        if (!isMounted) return
        registrationRef = registration
        lastUpdateCheckAtRef.current = Date.now()

        if (registration.waiting && navigator.serviceWorker.controller) {
          hasExistingControllerRef.current = true
          setWaitingWorker(registration.waiting)
          setDismissed(false)
        }

        if (registration.installing) {
          attachInstallingListener(registration.installing)
        }

        registration.addEventListener("updatefound", () => {
          if (!isMounted) return
          attachInstallingListener(registration.installing)
        })
      } catch {
        // Service worker registration is non-fatal (e.g. restricted private mode)
      }
    }

    if (document.readyState === "complete") {
      void registerSw()
    } else {
      window.addEventListener("load", registerSw, { once: true })
    }

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        registrationRef &&
        Date.now() - lastUpdateCheckAtRef.current >= UPDATE_CHECK_COOLDOWN_MS
      ) {
        lastUpdateCheckAtRef.current = Date.now()
        registrationRef.update().catch(() => {})
      }
    }

    const handleError = (event: ErrorEvent) => {
      if (isChunkLoadFailure(event.error ?? event.message)) {
        setChunkSkewDetected(true)
        setDismissed(false)
      }
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadFailure(event.reason)) {
        setChunkSkewDetected(true)
        setDismissed(false)
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("error", handleError)
    window.addEventListener("unhandledrejection", handleRejection)

    return () => {
      isMounted = false
      window.removeEventListener("load", registerSw)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("error", handleError)
      window.removeEventListener("unhandledrejection", handleRejection)
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange
      )
    }
  }, [])

  function handleApplyUpdate() {
    if (alreadyReloadedRef.current) return

    if (waitingWorker) {
      userConfirmedUpdateRef.current = true
      setIsActivating(true)
      try {
        waitingWorker.postMessage({ type: "SKIP_WAITING" })
      } catch {
        alreadyReloadedRef.current = true
        window.location.reload()
      }
      return
    }

    if (chunkSkewDetected) {
      try {
        const lastReload = Number(
          window.sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY) ?? "0"
        )
        const now = Date.now()
        if (now - lastReload < CHUNK_RECOVERY_COOLDOWN_MS) {
          setDismissed(true)
          return
        }
        window.sessionStorage.setItem(CHUNK_RECOVERY_STORAGE_KEY, String(now))
      } catch {
        // Ignore sessionStorage errors
      }
      alreadyReloadedRef.current = true
      window.location.reload()
    }
  }

  const showBanner =
    !dismissed && (waitingWorker !== null || chunkSkewDetected)

  if (!showBanner) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-banner"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-[var(--z-toast)] mx-auto max-w-md rounded-xl border border-primary-border bg-surface p-3.5 text-foreground shadow-lg md:right-6 md:bottom-6 md:left-auto md:mx-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-foreground">
            Pembaruan Smart RT Tersedia
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Versi terbaru aplikasi telah siap. Muat ulang saat Anda selesai
            dengan aktivitas saat ini.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Tutup pemberitahuan pembaruan"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDismissed(true)}
          disabled={isActivating}
        >
          Nanti
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleApplyUpdate}
          disabled={isActivating}
          data-testid="pwa-update-reload-btn"
        >
          <RefreshCwIcon className="size-3.5" />
          <span>{isActivating ? "Memperbarui..." : "Perbarui Sekarang"}</span>
        </Button>
      </div>
    </div>
  )
}

