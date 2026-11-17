/**
 * Smart RT — Invited Resident Direct Activation Edge Function
 *
 * Creates a confirmed Supabase Auth user (`email_confirm: true`) ONLY after
 * proving possession of a valid, unexpired, unredeemed 256-bit invitation token.
 *
 * Security invariants:
 * - Holds SUPABASE_SERVICE_ROLE_KEY strictly inside Supabase Edge Runtime.
 * - Never trusts email, tenant_id, resident_id, or role from request payload.
 * - Re-validates invitation token via `get_resident_invitation_claim_target`.
 * - Never overwrites password or confirms an existing confirmed user account
 *   (existing accounts must prove ownership via signInWithPassword).
 * - Never returns tokens, passwords, or service_role credentials.
 */

export interface ActivateInvitedResidentRequest {
  token?: unknown;
  password?: unknown;
}

export interface ActivateInvitedResidentDeps {
  envGet: (key: string) => string | undefined;
  fetchImpl?: typeof fetch;
}

const TOKEN_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleActivateInvitedResident(
  req: Request,
  deps: ActivateInvitedResidentDeps
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  let body: ActivateInvitedResidentRequest;
  try {
    body = (await req.json()) as ActivateInvitedResidentRequest;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!TOKEN_REGEX.test(token)) {
    return jsonResponse({ ok: false, reason: 'not_found', error: 'Invalid invitation token' }, 400);
  }

  if (password.length < 8 || password.length > 72) {
    return jsonResponse({ ok: false, error: 'Password must be between 8 and 72 characters' }, 400);
  }

  const supabaseUrl = deps.envGet('SUPABASE_URL')?.replace(/\/+$/, '');
  const serviceRoleKey = deps.envGet('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = deps.envGet('SUPABASE_ANON_KEY') ?? serviceRoleKey;
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return jsonResponse({ ok: false, error: 'Server configuration error' }, 500);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  // 1. Validate invitation strictly from database using the secret token
  //    Note: get_resident_invitation_claim_target is granted to anon/authenticated (revoked from service_role).
  const targetRes = await fetchImpl(
    `${supabaseUrl}/rest/v1/rpc/get_resident_invitation_claim_target`,
    {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    }
  );

  if (!targetRes.ok) {
    return jsonResponse({ ok: false, error: 'Failed to validate invitation' }, 502);
  }

  const target = (await targetRes.json()) as Record<string, unknown> | null;
  if (!target || target.valid !== true || typeof target.email !== 'string') {
    const reason = typeof target?.reason === 'string' ? target.reason : 'not_found';
    return jsonResponse({ ok: false, reason, error: 'Invitation is invalid or expired' }, 400);
  }

  const invitedEmail = target.email.trim().toLowerCase();
  const residentName =
    typeof target.resident_name === 'string' && target.resident_name.trim()
      ? target.resident_name.trim()
      : undefined;

  // 2. Create an already-confirmed Auth user so no email confirmation is required/sent
  const createRes = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: invitedEmail,
      password,
      email_confirm: true,
      user_metadata: residentName ? { full_name: residentName } : {},
    }),
  });

  if (createRes.ok) {
    return jsonResponse({ ok: true, status: 'created' }, 200);
  }

  // 3. If email already exists in auth.users, NEVER overwrite password blindly (account takeover guard).
  //    Return status = 'existing_user' so Server Action enforces password verification via signInWithPassword.
  const errPayload = (await createRes.json().catch(() => ({}))) as {
    code?: string;
    error_code?: string;
    msg?: string;
    message?: string;
  };
  const errCode = (errPayload.error_code ?? errPayload.code ?? '').toLowerCase();
  const errMsg = (errPayload.msg ?? errPayload.message ?? '').toLowerCase();

  if (
    createRes.status === 422 ||
    errCode === 'email_exists' ||
    errCode === 'user_already_exists' ||
    errMsg.includes('already')
  ) {
    return jsonResponse({ ok: true, status: 'existing_user' }, 200);
  }

  return jsonResponse({ ok: false, error: 'Failed to create resident account' }, 502);
}

interface DenoLike {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

const denoRuntime = (globalThis as unknown as { Deno?: DenoLike }).Deno;
if (
  denoRuntime &&
  typeof denoRuntime.serve === 'function' &&
  (import.meta as { main?: boolean }).main
) {
  denoRuntime.serve((req: Request) =>
    handleActivateInvitedResident(req, {
      envGet: (name: string) => denoRuntime.env.get(name),
    })
  );
}
