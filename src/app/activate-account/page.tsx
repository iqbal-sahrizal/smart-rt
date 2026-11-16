import { Suspense } from "react"
import { connection } from "next/server"

import { AuthGuardFallback } from "@/components/auth/auth-guard-fallback"
import { ActivateAccountView } from "@/components/invitations/activate-account-view"
import {
  getSignedInInvitationMatchState,
  validateInvitationToken,
} from "@/lib/invitations/queries"
import { createClient } from "@/lib/supabase/server"

type ActivateAccountSearchParams = Promise<{
  token?: string
  confirm_error?: string
}>

async function ActivateAccountGate({
  searchParams,
}: {
  searchParams: ActivateAccountSearchParams
}) {
  await connection()
  const resolved = await searchParams
  const token = typeof resolved.token === "string" ? resolved.token.trim() : ""
  const confirmError = resolved.confirm_error === "1"

  const supabase = await createClient()
  const [
    preview,
    {
      data: { user },
    },
  ] = await Promise.all([
    validateInvitationToken(token),
    supabase.auth.getUser(),
  ])

  const signedInEmail = user?.email ?? null
  const signedInMatchState =
    preview.valid && signedInEmail
      ? await getSignedInInvitationMatchState(token, signedInEmail)
      : "unauthenticated"

  return (
    <ActivateAccountView
      token={token}
      preview={preview}
      signedInEmail={signedInEmail}
      signedInMatchState={signedInMatchState}
      emailConfirmError={confirmError}
    />
  )
}

export default function ActivateAccountPage({
  searchParams,
}: {
  searchParams: ActivateAccountSearchParams
}) {
  return (
    <Suspense fallback={<AuthGuardFallback />}>
      <ActivateAccountGate searchParams={searchParams} />
    </Suspense>
  )
}

