import "server-only"

import { cookies, headers } from "next/headers"

import { WORKSPACE_COOKIE_NAME } from "@/lib/auth/workspace"

async function isHttpsOrigin(): Promise<boolean> {
  const headerStore = await headers()
  const proto = headerStore.get("x-forwarded-proto")
  if (proto) {
    return proto.split(",")[0].trim() === "https"
  }
  const origin = headerStore.get("origin")
  if (origin) {
    return origin.startsWith("https://")
  }
  return false
}

export async function setWorkspaceCookie(workspaceKey: string): Promise<void> {
  const cookieStore = await cookies()
  const secure = await isHttpsOrigin()
  cookieStore.set(WORKSPACE_COOKIE_NAME, workspaceKey, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearWorkspaceCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(WORKSPACE_COOKIE_NAME)
}

/**
 * Validates internal post-login redirect targets to avoid open-redirect attacks.
 */
export function resolveSafeNextPath(rawNext: unknown): string | null {
  if (typeof rawNext !== "string") return null
  const trimmed = rawNext.trim()
  if (!trimmed.startsWith("/")) return null
  if (trimmed.startsWith("//") || trimmed.includes("\\")) return null
  if (trimmed === "/activate-account" || trimmed.startsWith("/activate-account?")) {
    return trimmed
  }
  return null
}

