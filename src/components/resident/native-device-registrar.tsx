"use client"

import * as React from "react"
import { registerDeviceTokenAction } from "@/app/actions/notifications"

declare global {
  interface Window {
    SmartRTNative?: {
      postMessage: (message: string) => void
      addEventListener: (
        type: "message",
        listener: (event: MessageEvent<string>) => void
      ) => void
      removeEventListener: (
        type: "message",
        listener: (event: MessageEvent<string>) => void
      ) => void
      onmessage?: (event: MessageEvent<string>) => void
    }
  }
}

const REGISTERED_TOKEN_KEY = "smartrt_fcm_registered_token"

/**
 * Client component that automatically discovers the native Android shell bridge,
 * retrieves the device's FCM push token, and registers it to the active tenant.
 */
export function NativeDeviceRegistrar() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.SmartRTNative) {
      return
    }

    const bridge = window.SmartRTNative

    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.action === "getPushToken" && payload.success && payload.data?.token) {
          const fcmToken = payload.data.token as string
          const lastRegistered = sessionStorage.getItem(REGISTERED_TOKEN_KEY)

          if (fcmToken && fcmToken !== lastRegistered) {
            registerDeviceTokenAction({
              fcmToken,
              platform: "android",
              deviceInfo: {
                userAgent: navigator.userAgent,
                registeredVia: "ResidentShellWebMessageListener",
              },
            }).then((res) => {
              if (res.ok) {
                sessionStorage.setItem(REGISTERED_TOKEN_KEY, fcmToken)
              }
            }).catch((err) => {
              console.warn("[NativeDeviceRegistrar] Token registration error:", err)
            })
          }
        }
      } catch {
        // Non-JSON or irrelevant bridge message
      }
    }

    if (bridge.addEventListener) {
      bridge.addEventListener("message", handleMessage)
    } else {
      bridge.onmessage = handleMessage
    }

    // Request push token from native Android bridge
    try {
      bridge.postMessage(
        JSON.stringify({
          action: "getPushToken",
          id: `req-push-${Date.now()}`,
        })
      )
    } catch (err) {
      console.warn("[NativeDeviceRegistrar] Failed to query native bridge:", err)
    }

    return () => {
      if (bridge.removeEventListener) {
        bridge.removeEventListener("message", handleMessage)
      }
    }
  }, [])

  return null
}

