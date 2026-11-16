"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { clearWorkspaceCookie, setWorkspaceCookie } from "@/lib/auth/cookies"
import { requireAdminContext } from "@/lib/auth/guards"
import {
  buildActivationEmailRedirectTo,
  resolveActivationSignInOutcome,
  resolveActivationSignUpOutcome,
} from "@/lib/invitations/auth-flow"
import {
  createInvitationSchema,
  redeemNewPasswordSchema,
  redeemSignedInSchema,
  resendInvitationSchema,
  revokeInvitationSchema,
} from "@/lib/invitations/schemas"
import {
  canManageInvitations,
  type InvitationActionState,
  type RedeemInvitationActionState,
} from "@/lib/invitations/types"
import { createClient } from "@/lib/supabase/server"

function getStringField(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

function mapAdminRpcError(
  error: { code?: string; message?: string } | null
): string {
  const msg = error?.message ?? ""
  const lower = msg.toLowerCase()
  if (error?.code === "42501" || lower.includes("forbidden")) {
    return "Anda tidak memiliki izin untuk mengelola undangan aktivasi warga."
  }
  if (lower.includes("already has an active or linked account")) {
    return "Warga ini sudah memiliki akun portal aktif dan tidak dapat diundang ulang."
  }
  if (lower.includes("active pending invitation already exists")) {
    return "Warga ini sudah memiliki undangan aktif. Gunakan Kirim Ulang atau Batalkan undangan terlebih dahulu."
  }
  if (lower.includes("pending invitation for this email")) {
    return "Alamat email ini sedang digunakan pada undangan aktif untuk warga lain di RT yang sama."
  }
  if (lower.includes("only active residents")) {
    return "Hanya warga dengan status kependudukan aktif yang dapat diundang."
  }
  if (lower.includes("already redeemed")) {
    return "Undangan ini sudah selesai digunakan dan tidak dapat diubah."
  }
  if (lower.includes("only pending invitations can be revoked")) {
    return "Hanya undangan berstatus menunggu yang dapat dibatalkan."
  }
  if (lower.includes("invalid email")) {
    return "Format alamat email tidak valid."
  }
  if (error?.code === "P0002" || lower.includes("not found")) {
    return "Data warga atau undangan tidak ditemukan pada RT aktif."
  }
  return "Gagal memproses undangan aktivasi warga. Silakan coba lagi."
}

function mapRedeemErrorMessage(reasonOrMessage: string): string {
  const lower = reasonOrMessage.toLowerCase()
  if (lower === "revoked" || lower.includes("revoked")) {
    return "Undangan aktivasi ini telah dibatalkan oleh pengurus RT."
  }
  if (lower === "redeemed" || lower.includes("already been redeemed")) {
    return "Undangan aktivasi ini sudah pernah digunakan dan tidak dapat dipakai ulang."
  }
  if (lower === "expired" || lower.includes("expired")) {
    return "Undangan aktivasi ini telah kedaluwarsa. Minta pengurus RT untuk menerbitkan ulang undangan."
  }
  if (lower === "inactive_resident" || lower.includes("no longer active")) {
    return "Data warga atau RT tujuan sudah tidak aktif."
  }
  if (lower === "already_linked" || lower.includes("already linked to another")) {
    return "Warga ini sudah terhubung dengan akun aktif lain."
  }
  if (lower.includes("already linked to a different resident")) {
    return "Akun Anda sudah terhubung dengan data warga lain pada RT ini."
  }
  if (lower.includes("does not match")) {
    return "Email akun yang sedang masuk tidak sesuai dengan alamat email pada undangan."
  }
  if (lower === "not_found" || lower.includes("not found") || lower.includes("invalid invitation")) {
    return "Tautan undangan tidak ditemukan atau tidak valid."
  }
  return "Aktivasi akun gagal diproses. Silakan coba kembali atau hubungi pengurus RT."
}

export async function createResidentInvitationAction(
  _prevState: InvitationActionState,
  formData: FormData
): Promise<InvitationActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageInvitations(tenant.roles)) {
    return {
      error:
        "Hanya Ketua RT atau Sekretaris yang berwenang membuat undangan aktivasi warga.",
    }
  }

  const parsed = createInvitationSchema.safeParse({
    residentId: getStringField(formData, "residentId"),
    email: getStringField(formData, "email"),
    expiresInHours: getStringField(formData, "expiresInHours") || "168",
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali data undangan yang dimasukkan.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = await createClient()

  // Enforce active workspace tenant isolation before calling RPC
  const { data: residentCheck } = await supabase
    .from("residents")
    .select("id")
    .eq("id", parsed.data.residentId)
    .eq("tenant_id", tenant.tenantId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!residentCheck) {
    return {
      error: "Warga tidak ditemukan pada RT aktif Anda.",
    }
  }

  const { data, error } = await supabase.rpc("create_resident_invitation", {
    p_resident_id: parsed.data.residentId,
    p_email: parsed.data.email,
    p_expires_in_hours: parsed.data.expiresInHours,
  })

  if (error || !data || typeof data !== "object") {
    return {
      error: mapAdminRpcError(error),
    }
  }

  const payload = data as Record<string, unknown>
  const rawToken =
    typeof payload.raw_token === "string" ? payload.raw_token : null
  const invitedEmail =
    typeof payload.email === "string" ? payload.email : parsed.data.email
  const expiresAt =
    typeof payload.expires_at === "string" ? payload.expires_at : null

  if (!rawToken) {
    return {
      error: "Undangan dibuat tetapi tautan aktivasi gagal diterbitkan.",
    }
  }

  revalidatePath("/resident-invitations")
  revalidatePath(`/residents/${parsed.data.residentId}`)

  return {
    ok: true,
    error: null,
    activationPath: `/activate-account?token=${rawToken}`,
    invitedEmail,
    expiresAt,
    message: "Undangan aktivasi berhasil dibuat.",
  }
}

export async function revokeResidentInvitationAction(
  _prevState: InvitationActionState,
  formData: FormData
): Promise<InvitationActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageInvitations(tenant.roles)) {
    return {
      error:
        "Hanya Ketua RT atau Sekretaris yang berwenang membatalkan undangan.",
    }
  }

  const parsed = revokeInvitationSchema.safeParse({
    invitationId: getStringField(formData, "invitationId"),
  })

  if (!parsed.success) {
    return {
      error: "ID undangan tidak valid.",
    }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from("resident_invitations")
    .select("id, resident_id")
    .eq("id", parsed.data.invitationId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  if (!existing) {
    return {
      error: "Undangan tidak ditemukan pada RT aktif.",
    }
  }

  const { error } = await supabase.rpc("revoke_resident_invitation", {
    p_invitation_id: parsed.data.invitationId,
  })

  if (error) {
    return {
      error: mapAdminRpcError(error),
    }
  }

  const residentId = (existing as { resident_id: string }).resident_id
  revalidatePath("/resident-invitations")
  revalidatePath(`/residents/${residentId}`)

  return {
    ok: true,
    error: null,
    message: "Undangan aktivasi berhasil dibatalkan.",
  }
}

export async function resendResidentInvitationAction(
  _prevState: InvitationActionState,
  formData: FormData
): Promise<InvitationActionState> {
  const { tenant } = await requireAdminContext()

  if (!canManageInvitations(tenant.roles)) {
    return {
      error:
        "Hanya Ketua RT atau Sekretaris yang berwenang menerbitkan ulang undangan.",
    }
  }

  const parsed = resendInvitationSchema.safeParse({
    invitationId: getStringField(formData, "invitationId"),
    email: getStringField(formData, "email"),
    expiresInHours: getStringField(formData, "expiresInHours") || "168",
  })

  if (!parsed.success) {
    return {
      error: "Periksa kembali data penerbitan ulang undangan.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from("resident_invitations")
    .select("id, resident_id")
    .eq("id", parsed.data.invitationId)
    .eq("tenant_id", tenant.tenantId)
    .maybeSingle()

  if (!existing) {
    return {
      error: "Undangan tidak ditemukan pada RT aktif.",
    }
  }

  const { data, error } = await supabase.rpc("resend_resident_invitation", {
    p_invitation_id: parsed.data.invitationId,
    p_email: parsed.data.email ?? null,
    p_expires_in_hours: parsed.data.expiresInHours,
  })

  if (error || !data || typeof data !== "object") {
    return {
      error: mapAdminRpcError(error),
    }
  }

  const payload = data as Record<string, unknown>
  const rawToken =
    typeof payload.raw_token === "string" ? payload.raw_token : null
  const invitedEmail =
    typeof payload.email === "string" ? payload.email : null
  const expiresAt =
    typeof payload.expires_at === "string" ? payload.expires_at : null

  if (!rawToken) {
    return {
      error: "Tautan aktivasi baru gagal dibuat.",
    }
  }

  const residentId = (existing as { resident_id: string }).resident_id
  revalidatePath("/resident-invitations")
  revalidatePath(`/residents/${residentId}`)

  return {
    ok: true,
    error: null,
    activationPath: `/activate-account?token=${rawToken}`,
    invitedEmail,
    expiresAt,
    message: "Undangan baru berhasil diterbitkan.",
  }
}

async function resolveSafeRequestOrigin(): Promise<string | null> {
  const headerStore = await headers()
  const rawOrigin = headerStore.get("origin")?.trim()
  if (rawOrigin) {
    try {
      const parsed = new URL(rawOrigin)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin
      }
    } catch {
      // fall back to host headers
    }
  }

  const forwardedHost = headerStore
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
  const host = forwardedHost || headerStore.get("host")?.trim()
  if (!host || /[\s\\/@]/.test(host)) {
    return null
  }

  const forwardedProto = headerStore
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase()
  const proto = forwardedProto === "https" ? "https" : "http"
  try {
    return new URL(`${proto}://${host}`).origin
  } catch {
    return null
  }
}

export async function signOutToSwitchInvitationAccountAction(
  formData: FormData
): Promise<void> {
  const token = getStringField(formData, "token").trim()
  const supabase = await createClient()
  await supabase.auth.signOut()
  await clearWorkspaceCookie()

  if (token) {
    redirect(`/activate-account?token=${encodeURIComponent(token)}`)
  }
  redirect("/activate-account")
}

export async function redeemInvitationAction(
  _prevState: RedeemInvitationActionState,
  formData: FormData
): Promise<RedeemInvitationActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const rawToken = getStringField(formData, "token")
  let verifiedToken: string
  let isNewSessionCreatedHere = false

  if (user) {
    const parsed = redeemSignedInSchema.safeParse({ token: rawToken })
    if (!parsed.success) {
      return {
        error: "Token undangan tidak valid.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      }
    }
    verifiedToken = parsed.data.token
  } else {
    // Explicitly parse ONLY token, password, confirmPassword; ignore any manipulated role/tenantId/residentId
    const parsed = redeemNewPasswordSchema.safeParse({
      token: rawToken,
      password: getStringField(formData, "password"),
      confirmPassword: getStringField(formData, "confirmPassword"),
    })

    if (!parsed.success) {
      return {
        error: "Periksa kembali token dan kata sandi Anda.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      }
    }

    verifiedToken = parsed.data.token

    // Validate token BEFORE touching Auth so invalid/expired/revoked tokens never create auth users
    const { data: targetData, error: targetError } = await supabase.rpc(
      "get_resident_invitation_claim_target",
      { p_token: verifiedToken }
    )

    if (targetError || !targetData || typeof targetData !== "object") {
      return {
        error: "Tautan undangan tidak ditemukan atau tidak valid.",
      }
    }

    const target = targetData as Record<string, unknown>
    if (target.valid !== true || typeof target.email !== "string") {
      const reason =
        typeof target.reason === "string" ? target.reason : "not_found"
      return {
        error: mapRedeemErrorMessage(reason),
      }
    }

    const invitedEmail = target.email
    const residentName =
      typeof target.resident_name === "string" ? target.resident_name : undefined
    const requestOrigin = await resolveSafeRequestOrigin()
    const emailRedirectTo = buildActivationEmailRedirectTo(
      requestOrigin,
      verifiedToken
    )

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: invitedEmail,
      password: parsed.data.password,
      options: {
        ...(residentName ? { data: { full_name: residentName } } : {}),
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    })

    const signUpDecision = resolveActivationSignUpOutcome({
      signUpError: signUpError as
        | { code?: string; message?: string; status?: number }
        | null,
      hasSignUpSession: Boolean(signUpData?.session),
    })

    if (signUpDecision.action === "fail") {
      return { error: signUpDecision.error }
    }

    if (signUpDecision.action === "attempt_sign_in") {
      // Existing confirmed users prove ownership via their current password.
      // Unconfirmed accounts receive `email_not_confirmed` -> guided confirmation flow.
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: invitedEmail,
          password: parsed.data.password,
        })

      const signInDecision = resolveActivationSignInOutcome({
        signInError: signInError as
          | { code?: string; message?: string; status?: number }
          | null,
        hasSignInSession: Boolean(signInData?.session),
      })

      if (signInDecision.action === "needs_email_confirmation") {
        return {
          ok: false,
          error: null,
          needsEmailConfirmation: true,
          confirmationMessage: signInDecision.message,
        }
      }

      if (signInDecision.action === "fail") {
        return { error: signInDecision.error }
      }
    }

    isNewSessionCreatedHere = true
  }

  // Atomic database redemption (locks invitation, checks email match, links tenant_members + 'warga' only)
  const { data: redeemData, error: redeemError } = await supabase.rpc(
    "redeem_resident_invitation",
    { p_token: verifiedToken }
  )

  if (redeemError || !redeemData || typeof redeemData !== "object") {
    if (isNewSessionCreatedHere) {
      await supabase.auth.signOut()
      await clearWorkspaceCookie()
    }
    return {
      error: mapRedeemErrorMessage(redeemError?.message ?? "unknown"),
    }
  }

  const result = redeemData as Record<string, unknown>
  const tenantId = typeof result.tenant_id === "string" ? result.tenant_id : ""
  const tenantName =
    typeof result.tenant_name === "string" ? result.tenant_name : "RT Anda"
  const rtNumber =
    typeof result.rt_number === "string" ? result.rt_number : "-"
  const rwNumber =
    typeof result.rw_number === "string" ? result.rw_number : "-"
  const residentName =
    typeof result.resident_name === "string" ? result.resident_name : "Warga"

  if (tenantId) {
    const {
      data: { user: activeUser },
    } = await supabase.auth.getUser()

    if (activeUser) {
      await supabase
        .from("profiles")
        .update({ active_tenant_id: tenantId })
        .eq("id", activeUser.id)
    }

    await setWorkspaceCookie(`resident:${tenantId}`)
  }

  revalidatePath("/resident")
  revalidatePath("/select-tenant")
  revalidatePath("/resident-invitations")

  return {
    ok: true,
    error: null,
    activated: {
      tenantId,
      tenantName,
      rtNumber,
      rwNumber,
      residentName,
      assignedRole: "warga",
    },
  }
}

export async function resendInvitationConfirmationAction(
  _prevState: RedeemInvitationActionState,
  formData: FormData
): Promise<RedeemInvitationActionState> {
  const parsed = redeemSignedInSchema.safeParse({
    token: getStringField(formData, "token"),
  })

  if (!parsed.success) {
    return {
      error: "Token undangan tidak valid.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = await createClient()
  const { data: targetData, error: targetError } = await supabase.rpc(
    "get_resident_invitation_claim_target",
    { p_token: parsed.data.token }
  )

  if (targetError || !targetData || typeof targetData !== "object") {
    return {
      error: "Tautan undangan tidak ditemukan atau tidak valid.",
    }
  }

  const target = targetData as Record<string, unknown>
  if (target.valid !== true || typeof target.email !== "string") {
    const reason =
      typeof target.reason === "string" ? target.reason : "not_found"
    return {
      error: mapRedeemErrorMessage(reason),
    }
  }

  const requestOrigin = await resolveSafeRequestOrigin()
  const emailRedirectTo = buildActivationEmailRedirectTo(
    requestOrigin,
    parsed.data.token
  )

  const { error: resendError } = await supabase.auth.resend({
    type: "signup",
    email: target.email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  })

  if (resendError && resendError.status === 429) {
    return {
      ok: false,
      error:
        "Terlalu banyak permintaan kirim ulang konfirmasi. Silakan tunggu beberapa saat lalu coba lagi.",
      needsEmailConfirmation: true,
    }
  }

  return {
    ok: false,
    error: null,
    needsEmailConfirmation: true,
    confirmationMessage:
      "Jika akun menunggu verifikasi, tautan konfirmasi baru telah dikirim ke alamat email undangan Anda.",
  }
}

