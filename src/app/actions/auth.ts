"use server"

import { redirect } from "next/navigation"

import {
  clearWorkspaceCookie,
  resolveSafeNextPath,
  setWorkspaceCookie,
} from "@/lib/auth/cookies"
import { loginSchema, selectWorkspaceSchema } from "@/lib/auth/schemas"
import { getAuthContext } from "@/lib/auth/server"
import { resolvePostLoginRoute } from "@/lib/auth/workspace"
import { createClient } from "@/lib/supabase/server"

export interface LoginActionState {
  error: string | null
  fieldErrors?: {
    email?: string[]
    password?: string[]
  }
}

function mapSupabaseAuthError(message: string, status?: number): string {
  const normalized = message.toLowerCase()
  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid_credentials")
  ) {
    return "Email atau kata sandi tidak valid."
  }
  if (normalized.includes("email not confirmed")) {
    return "Akun Anda belum terverifikasi. Hubungi pengurus RT atau administrator."
  }
  if (status === 429 || normalized.includes("rate limit")) {
    return "Terlalu banyak percobaan masuk. Silakan tunggu beberapa saat lalu coba lagi."
  }
  return "Gagal masuk ke akun. Silakan periksa kredensial Anda atau coba lagi nanti."
}

export async function loginAction(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali email dan kata sandi Anda.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  let destination: string | null = null

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (error) {
      return {
        error: mapSupabaseAuthError(error.message, error.status),
      }
    }

    // Never inherit a stale workspace cookie from an earlier session
    await clearWorkspaceCookie()

    const ctx = await getAuthContext()
    if (!ctx) {
      return {
        error: "Sesi autentikasi gagal diverifikasi. Silakan coba lagi.",
      }
    }

    const safeNextPath = resolveSafeNextPath(formData.get("next"))

    if (ctx.workspaceOptions.length === 1) {
      const onlyWorkspace = ctx.workspaceOptions[0]
      await setWorkspaceCookie(onlyWorkspace.key)
      if (ctx.profile.activeTenantId !== onlyWorkspace.tenantId) {
        await supabase
          .from("profiles")
          .update({ active_tenant_id: onlyWorkspace.tenantId })
          .eq("id", ctx.user.id)
      }
      destination = safeNextPath ?? onlyWorkspace.href
    } else {
      if (ctx.profile.activeTenantId !== null) {
        await supabase
          .from("profiles")
          .update({ active_tenant_id: null })
          .eq("id", ctx.user.id)
      }
      destination =
        safeNextPath ?? resolvePostLoginRoute(ctx.workspaceOptions, null)
    }
  } catch {
    return {
      error: "Layanan autentikasi sedang tidak tersedia. Pastikan konfigurasi server valid.",
    }
  }

  redirect(destination)
}

export async function selectWorkspaceAction(formData: FormData): Promise<void> {
  const rawTenantId = formData.get("tenantId")
  const parsed = selectWorkspaceSchema.safeParse({
    workspaceType: formData.get("workspaceType"),
    tenantId:
      typeof rawTenantId === "string" && rawTenantId.trim() !== ""
        ? rawTenantId.trim()
        : null,
  })

  if (!parsed.success) {
    redirect("/select-tenant?error=invalid")
  }

  const ctx = await getAuthContext()
  if (!ctx) {
    redirect("/login")
  }

  const matched = ctx.workspaceOptions.find(
    (opt) =>
      opt.type === parsed.data.workspaceType &&
      opt.tenantId === parsed.data.tenantId
  )

  if (!matched) {
    redirect("/select-tenant?error=unauthorized")
  }

  const nextActiveTenantId = matched.tenantId ?? null
  if (ctx.profile.activeTenantId !== nextActiveTenantId) {
    const supabase = await createClient()
    const { error } = await supabase
      .from("profiles")
      .update({ active_tenant_id: nextActiveTenantId })
      .eq("id", ctx.user.id)

    if (error) {
      redirect("/select-tenant?error=update_failed")
    }
  }

  await setWorkspaceCookie(matched.key)
  redirect(matched.href)
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    await supabase
      .from("profiles")
      .update({ active_tenant_id: null })
      .eq("id", user.id)
  }

  await supabase.auth.signOut()
  await clearWorkspaceCookie()
  redirect("/login")
}
