/**
 * Smart RT — FCM Push Notification Dispatcher (Supabase Edge Function)
 *
 * Dispatches push notifications to Android devices via Firebase Cloud Messaging HTTP v1 API.
 *
 * Security & Design Principles:
 * - Strict FCM HTTP v1 (No legacy server keys).
 * - Multi-tenant enforcement: device tokens must match requested tenant_id and recipient_user_id.
 * - Service account credentials stored exclusively in environment variables (never committed).
 * - Uses native Web Crypto (SubtleCrypto RSASSA-PKCS1-v1_5 SHA-256) for OAuth2 JWT assertion.
 * - Automatically deactivates unregistered/stale FCM tokens (UNREGISTERED / NOT_FOUND).
 * - Requires authorization bearer token (internal secret or service_role).
 */

export interface FcmDispatchPayload {
  tenant_id: string;
  recipient_user_ids: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface ServiceAccountCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface DeviceTokenRow {
  id: string;
  user_id: string;
  fcm_token: string;
}

export interface FcmDispatchResult {
  ok: boolean;
  total_recipients: number;
  total_tokens: number;
  success_count: number;
  failure_count: number;
  deactivated_tokens: number;
  errors?: string[];
}

export interface OutboxWorkerRow {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  event_type: string;
  reference_type: string | null;
  reference_id: string | null;
  target_scope?: 'resident' | 'admin';
  title: string;
  body: string;
  claim_token?: string | null;
}

export interface OutboxProcessResult {
  ok: boolean;
  mode: 'process_outbox';
  claimed_count: number;
  sent_count: number;
  failed_count: number;
  groups_processed: number;
  deactivated_tokens: number;
  errors?: string[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveOutboxDestinationPath(
  targetScope: 'resident' | 'admin',
  referenceType: string | null,
  referenceId: string | null
): string | null {
  if (!referenceType) return null;
  const normalizedType = referenceType.trim().toLowerCase();
  const safeId = referenceId && UUID_REGEX.test(referenceId) ? referenceId : null;

  if (targetScope === 'admin') {
    switch (normalizedType) {
      case 'announcements':
      case 'announcement':
        return safeId ? `/announcements/${safeId}` : '/announcements';
      case 'bills':
      case 'bill':
        return safeId ? `/bills/${safeId}` : '/bills';
      case 'payments':
      case 'payment':
        return safeId ? `/payments/${safeId}` : '/payments';
      case 'complaints':
      case 'complaint':
        return safeId ? `/pengaduan/${safeId}` : '/pengaduan';
      case 'letter_requests':
      case 'letter_request':
      case 'letters':
      case 'letter':
        return '/surat';
      case 'activities':
      case 'activity':
        return safeId ? `/kegiatan/${safeId}` : '/kegiatan';
      case 'ronda_schedules':
      case 'ronda_schedule':
      case 'ronda':
        return '/ronda';
      case 'community_post':
      case 'community_posts':
      case 'community':
        return '/komunitas';
      default:
        return null;
    }
  }

  switch (normalizedType) {
    case 'announcements':
    case 'announcement':
      return safeId ? `/resident/announcements/${safeId}` : '/resident/announcements';
    case 'bills':
    case 'bill':
      return safeId ? `/resident/bills/${safeId}` : '/resident/bills';
    case 'payments':
    case 'payment':
      return '/resident/bills';
    case 'households':
    case 'household':
      return '/resident/household';
    case 'residents':
    case 'resident':
    case 'resident_invitations':
    case 'resident_invitation':
      return '/resident/profile';
    case 'complaints':
    case 'complaint':
      return safeId ? `/resident/complaints/${safeId}` : '/resident/complaints';
    case 'letter_requests':
    case 'letter_request':
    case 'letters':
    case 'letter':
      return safeId ? `/resident/letters/${safeId}` : '/resident/letters';
    case 'activities':
    case 'activity':
      return safeId ? `/resident/activities/${safeId}` : '/resident/activities';
    case 'ronda_schedules':
    case 'ronda_schedule':
    case 'ronda':
      return safeId ? `/resident/ronda/${safeId}` : '/resident/ronda';
    case 'community_post':
    case 'community_posts':
    case 'community':
      return '/resident/feed';
    default:
      return null;
  }
}

/**
 * Parses and normalizes PKCS#8 PEM private key into binary ArrayBuffer.
 */
export function pemToBinary(pem: string): ArrayBuffer {
  const cleanPem = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const binaryString = atob(cleanPem);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Base64URL encoder utility.
 */
export function base64UrlEncode(data: Uint8Array | string): string {
  const str = typeof data === 'string'
    ? btoa(data)
    : btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generates an RS256-signed JWT assertion for Google OAuth2 token exchange.
 */
export async function createGoogleJwtAssertion(
  clientEmail: string,
  privateKeyPem: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const binaryKey = pemToBinary(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(unsignedToken)
  );

  const signature = base64UrlEncode(new Uint8Array(signatureBuffer));
  return `${unsignedToken}.${signature}`;
}

/**
 * Obtains a short-lived Google OAuth2 access token for FCM HTTP v1.
 */
export async function getGoogleOAuth2AccessToken(
  clientEmail: string,
  privateKeyPem: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const assertion = await createGoogleJwtAssertion(clientEmail, privateKeyPem);
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: assertion,
  });

  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google OAuth2 token exchange failed [HTTP ${response.status}]: ${errorBody}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

/**
 * Dispatches a push notification via FCM HTTP v1 messages:send.
 */
export async function sendFcmHttpV1Message(
  projectId: string,
  accessToken: string,
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<{ success: boolean; status: number; error?: string; shouldDeactivateToken?: boolean }> {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const payload = {
    message: {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: data ?? {},
      android: {
        priority: 'high',
        notification: {
          channel_id: 'smartrt_resident_notifications',
          icon: 'ic_notification',
          color: '#1E3A8A',
        },
      },
    },
  };

  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }

    const errorText = await res.text();
    // 404 or UNREGISTERED indicates stale/expired device token
    const shouldDeactivate = res.status === 404 ||
      errorText.includes('UNREGISTERED') ||
      errorText.includes('NOT_FOUND') ||
      errorText.includes('INVALID_ARGUMENT');

    return {
      success: false,
      status: res.status,
      error: errorText,
      shouldDeactivateToken: shouldDeactivate,
    };
  } catch (err) {
    return {
      success: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      shouldDeactivateToken: false,
    };
  }
}

/**
 * Loads service account credentials from environment variables.
 */
export function loadServiceAccountCredentials(
  envGet: (key: string) => string | undefined
): ServiceAccountCredentials | null {
  // Option 1: Full JSON string
  const jsonStr = envGet('FIREBASE_SERVICE_ACCOUNT');
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
    } catch {
      // Fall through to individual variables
    }
  }

  // Option 2: Individual env vars
  const projectId = envGet('FIREBASE_PROJECT_ID') || 'smart-rt-15e23';
  const clientEmail = envGet('FIREBASE_CLIENT_EMAIL');
  const privateKey = envGet('FIREBASE_PRIVATE_KEY');

  if (clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

interface OutboxBatchGroup {
  tenantId: string;
  targetScope: 'resident' | 'admin';
  referenceType: string | null;
  referenceId: string | null;
  title: string;
  body: string;
  recipientUserIds: string[];
  rows: OutboxWorkerRow[];
}

async function fetchActiveTokensForRecipients(
  supabaseUrl: string,
  serviceRoleKey: string,
  tenantId: string,
  recipientUserIds: string[],
  fetchImpl: typeof fetch
): Promise<{ ok: true; tokens: DeviceTokenRow[] } | { ok: false; error: string }> {
  const userIdsParam = recipientUserIds.join(',');
  const queryUrl = `${supabaseUrl}/rest/v1/user_device_tokens?tenant_id=eq.${tenantId}&user_id=in.(${userIdsParam})&is_active=eq.true&select=id,user_id,fcm_token`;

  const tokensRes = await fetchImpl(queryUrl, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
  });

  if (!tokensRes.ok) {
    const errText = await tokensRes.text();
    return { ok: false, error: `Failed to query device tokens from database: ${errText}` };
  }

  const tokens = (await tokensRes.json()) as DeviceTokenRow[];
  return { ok: true, tokens };
}

async function deactivateStaleTokens(
  supabaseUrl: string,
  serviceRoleKey: string,
  staleTokenIds: string[],
  fetchImpl: typeof fetch
): Promise<number> {
  if (staleTokenIds.length === 0) return 0;
  const updateUrl = `${supabaseUrl}/rest/v1/user_device_tokens?id=in.(${staleTokenIds.join(',')})`;
  try {
    const updateRes = await fetchImpl(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ is_active: false }),
    });
    return updateRes.ok ? staleTokenIds.length : 0;
  } catch {
    return 0;
  }
}

async function recordOutboxResult(
  supabaseUrl: string,
  serviceRoleKey: string,
  outboxId: string,
  success: boolean,
  errorText: string | null,
  claimToken: string | null | undefined,
  fetchImpl: typeof fetch
): Promise<void> {
  await fetchImpl(`${supabaseUrl}/rest/v1/rpc/record_notification_outbox_result`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_outbox_id: outboxId,
      p_success: success,
      p_error: errorText,
      p_claim_token: claimToken ?? null,
    }),
  });
}

async function handleProcessOutboxRequest(
  rawPayload: Record<string, unknown>,
  deps: {
    envGet: (k: string) => string | undefined;
    fetchImpl: typeof fetch;
  }
): Promise<Response> {
  const supabaseUrl = deps.envGet('SUPABASE_URL');
  const serviceRoleKey = deps.envGet('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase URL or service role key missing in environment' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const credentials = loadServiceAccountCredentials(deps.envGet);
  if (!credentials) {
    return new Response(
      JSON.stringify({ error: 'Firebase service account credentials not configured in environment' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rawLimit = Number(rawPayload.limit ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.trunc(rawLimit), 200)) : 50;
  const rawLease = Number(rawPayload.lease_seconds ?? 120);
  const leaseSeconds = Number.isFinite(rawLease) ? Math.max(10, Math.min(Math.trunc(rawLease), 3600)) : 120;

  const claimRes = await deps.fetchImpl(`${supabaseUrl}/rest/v1/rpc/claim_pending_notification_outbox_batch`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_limit: limit, p_lease_seconds: leaseSeconds }),
  });

  if (!claimRes.ok) {
    const errText = await claimRes.text();
    return new Response(
      JSON.stringify({ error: `Failed to claim outbox batch: ${errText}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const claimedRows = (await claimRes.json()) as OutboxWorkerRow[];
  if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
    const emptyResult: OutboxProcessResult = {
      ok: true,
      mode: 'process_outbox',
      claimed_count: 0,
      sent_count: 0,
      failed_count: 0,
      groups_processed: 0,
      deactivated_tokens: 0,
    };
    return new Response(JSON.stringify(emptyResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const groupsMap = new Map<string, OutboxBatchGroup>();
  for (const row of claimedRows) {
    const targetScope: 'resident' | 'admin' = row.target_scope === 'admin' ? 'admin' : 'resident';
    const key = [row.tenant_id, targetScope, row.reference_type ?? '', row.reference_id ?? '', row.title, row.body].join('::');
    const existing = groupsMap.get(key);
    if (existing) {
      if (!existing.recipientUserIds.includes(row.recipient_user_id)) {
        existing.recipientUserIds.push(row.recipient_user_id);
      }
      existing.rows.push(row);
    } else {
      groupsMap.set(key, {
        tenantId: row.tenant_id,
        targetScope,
        referenceType: row.reference_type,
        referenceId: row.reference_id,
        title: row.title,
        body: row.body,
        recipientUserIds: [row.recipient_user_id],
        rows: [row],
      });
    }
  }

  const groups = Array.from(groupsMap.values());
  let cachedAccessToken: string | null = null;
  let oauthError: string | null = null;
  let sentCount = 0;
  let failedCount = 0;
  let totalDeactivated = 0;
  const errors: string[] = [];

  for (const group of groups) {
    const tokensResult = await fetchActiveTokensForRecipients(
      supabaseUrl,
      serviceRoleKey,
      group.tenantId,
      group.recipientUserIds,
      deps.fetchImpl
    );

    if (!tokensResult.ok) {
      errors.push(tokensResult.error);
      for (const row of group.rows) {
        await recordOutboxResult(supabaseUrl, serviceRoleKey, row.id, false, tokensResult.error, row.claim_token, deps.fetchImpl);
        failedCount++;
      }
      continue;
    }

    if (tokensResult.tokens.length === 0) {
      for (const row of group.rows) {
        await recordOutboxResult(supabaseUrl, serviceRoleKey, row.id, true, null, row.claim_token, deps.fetchImpl);
        sentCount++;
      }
      continue;
    }

    if (!cachedAccessToken && !oauthError) {
      try {
        cachedAccessToken = await getGoogleOAuth2AccessToken(
          credentials.clientEmail,
          credentials.privateKey,
          deps.fetchImpl
        );
      } catch (err) {
        oauthError = `Failed to authenticate with Google OAuth2: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (oauthError || !cachedAccessToken) {
      const errMsg = oauthError ?? 'Missing Google OAuth2 access token';
      errors.push(errMsg);
      for (const row of group.rows) {
        await recordOutboxResult(supabaseUrl, serviceRoleKey, row.id, false, errMsg, row.claim_token, deps.fetchImpl);
        failedCount++;
      }
      continue;
    }

    const navPath = resolveOutboxDestinationPath(group.targetScope, group.referenceType, group.referenceId);
    const navData = navPath ? { path: navPath } : undefined;

    const staleTokenIds: string[] = [];
    const userOutcome = new Map<string, { succeeded: number; transientFailed: number; lastError: string | null }>();

    for (const tokenRow of tokensResult.tokens) {
      const outcome = userOutcome.get(tokenRow.user_id) ?? { succeeded: 0, transientFailed: 0, lastError: null };
      const sendResult = await sendFcmHttpV1Message(
        credentials.projectId,
        cachedAccessToken,
        tokenRow.fcm_token,
        group.title,
        group.body,
        navData,
        deps.fetchImpl
      );

      if (sendResult.success) {
        outcome.succeeded++;
      } else if (sendResult.shouldDeactivateToken) {
        staleTokenIds.push(tokenRow.id);
      } else {
        outcome.transientFailed++;
        outcome.lastError = sendResult.error ?? 'FCM dispatch failed';
      }
      userOutcome.set(tokenRow.user_id, outcome);
    }

    totalDeactivated += await deactivateStaleTokens(supabaseUrl, serviceRoleKey, staleTokenIds, deps.fetchImpl);

    for (const row of group.rows) {
      const outcome = userOutcome.get(row.recipient_user_id);
      const rowFailed = Boolean(outcome && outcome.succeeded === 0 && outcome.transientFailed > 0);
      const rowError = rowFailed ? (outcome?.lastError ?? 'FCM dispatch failed') : null;
      if (rowError) errors.push(`Outbox ${row.id}: ${rowError}`);

      await recordOutboxResult(supabaseUrl, serviceRoleKey, row.id, !rowFailed, rowError, row.claim_token, deps.fetchImpl);
      if (rowFailed) {
        failedCount++;
      } else {
        sentCount++;
      }
    }
  }

  const outboxResult: OutboxProcessResult = {
    ok: failedCount === 0 || sentCount > 0,
    mode: 'process_outbox',
    claimed_count: claimedRows.length,
    sent_count: sentCount,
    failed_count: failedCount,
    groups_processed: groups.length,
    deactivated_tokens: totalDeactivated,
    errors: errors.length > 0 ? errors : undefined,
  };

  return new Response(JSON.stringify(outboxResult), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handles incoming HTTP request to the Edge Function.
 */
export async function handleFcmRequest(
  req: Request,
  deps: {
    envGet: (k: string) => string | undefined;
    fetchImpl?: typeof fetch;
  }
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Authenticate caller (internal bearer secret, service role, or pg_cron single-use nonce for process_outbox)
  const authHeader = req.headers.get('Authorization') ?? '';
  const expectedSecret = deps.envGet('FCM_FUNCTION_SECRET') || deps.envGet('SUPABASE_SERVICE_ROLE_KEY');
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const hasBearerAuth = Boolean(expectedSecret && bearerToken === expectedSecret);
  const dispatchNonce = (req.headers.get('X-Outbox-Dispatch-Nonce') ?? '').trim();

  if (!hasBearerAuth && !dispatchNonce) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid function secret' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse and validate JSON request body
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  if (!hasBearerAuth) {
    if (!rawBody || typeof rawBody !== 'object' || rawBody.mode !== 'process_outbox') {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid function secret' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = deps.envGet('SUPABASE_URL');
    const serviceRoleKey = deps.envGet('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase URL or service role key missing in environment' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const nonceRes = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/consume_notification_dispatch_nonce`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_nonce: dispatchNonce }),
    });

    const consumed = nonceRes.ok ? await nonceRes.json() : false;
    if (consumed !== true) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired dispatch nonce' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (rawBody && typeof rawBody === 'object' && rawBody.mode === 'process_outbox') {
    return handleProcessOutboxRequest(rawBody, {
      envGet: deps.envGet,
      fetchImpl,
    });
  }

  const payload = rawBody as unknown as FcmDispatchPayload;
  const { tenant_id, recipient_user_ids, title, body, data } = payload;

  if (!tenant_id || !Array.isArray(recipient_user_ids) || recipient_user_ids.length === 0 || !title || !body) {
    return new Response(
      JSON.stringify({
        error: 'Missing required fields: tenant_id, recipient_user_ids (array), title, body',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3. Load Firebase credentials
  const credentials = loadServiceAccountCredentials(deps.envGet);
  if (!credentials) {
    return new Response(
      JSON.stringify({
        error: 'Firebase service account credentials not configured in environment',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 4. Query active device tokens for the given recipients within the tenant
  const supabaseUrl = deps.envGet('SUPABASE_URL');
  const serviceRoleKey = deps.envGet('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase URL or service role key missing in environment' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build query: GET /rest/v1/user_device_tokens?tenant_id=eq.{tenant_id}&user_id=in.({user_ids})&is_active=eq.true
  const userIdsParam = recipient_user_ids.join(',');
  const queryUrl = `${supabaseUrl}/rest/v1/user_device_tokens?tenant_id=eq.${tenant_id}&user_id=in.(${userIdsParam})&is_active=eq.true&select=id,user_id,fcm_token`;

  const tokensRes = await fetchImpl(queryUrl, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
  });

  if (!tokensRes.ok) {
    const errText = await tokensRes.text();
    return new Response(
      JSON.stringify({ error: `Failed to query device tokens from database: ${errText}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const tokens = await tokensRes.json() as DeviceTokenRow[];

  if (tokens.length === 0) {
    const emptyResult: FcmDispatchResult = {
      ok: true,
      total_recipients: recipient_user_ids.length,
      total_tokens: 0,
      success_count: 0,
      failure_count: 0,
      deactivated_tokens: 0,
    };
    return new Response(JSON.stringify(emptyResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 5. Exchange assertion for OAuth2 access token
  let accessToken: string;
  try {
    accessToken = await getGoogleOAuth2AccessToken(
      credentials.clientEmail,
      credentials.privateKey,
      fetchImpl
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `Failed to authenticate with Google OAuth2: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 6. Send push messages
  let successCount = 0;
  let failureCount = 0;
  let deactivatedCount = 0;
  const dispatchErrors: string[] = [];
  const staleTokenIds: string[] = [];

  for (const tokenRow of tokens) {
    const sendResult = await sendFcmHttpV1Message(
      credentials.projectId,
      accessToken,
      tokenRow.fcm_token,
      title,
      body,
      data,
      fetchImpl
    );

    if (sendResult.success) {
      successCount++;
    } else {
      failureCount++;
      if (sendResult.error) {
        dispatchErrors.push(`Token ${tokenRow.id}: ${sendResult.error}`);
      }
      if (sendResult.shouldDeactivateToken) {
        staleTokenIds.push(tokenRow.id);
      }
    }
  }

  // 7. Batch deactivate stale tokens if any
  if (staleTokenIds.length > 0) {
    const updateUrl = `${supabaseUrl}/rest/v1/user_device_tokens?id=in.(${staleTokenIds.join(',')})`;
    try {
      const updateRes = await fetchImpl(updateUrl, {
        method: 'PATCH',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ is_active: false }),
      });
      if (updateRes.ok) {
        deactivatedCount = staleTokenIds.length;
      }
    } catch {
      // Non-fatal: token deactivation failed, will retry on next push attempt
    }
  }

  const result: FcmDispatchResult = {
    ok: failureCount === 0 || successCount > 0,
    total_recipients: recipient_user_ids.length,
    total_tokens: tokens.length,
    success_count: successCount,
    failure_count: failureCount,
    deactivated_tokens: deactivatedCount,
    errors: dispatchErrors.length > 0 ? dispatchErrors : undefined,
  };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Runtime entry point for Deno / Supabase Edge Runtime
interface DenoLike {
  env: { get(key: string): string | undefined };
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

const denoRuntime = (globalThis as unknown as { Deno?: DenoLike }).Deno;
if (denoRuntime && typeof denoRuntime.serve === 'function' && (import.meta as { main?: boolean }).main) {
  denoRuntime.serve((req: Request) =>
    handleFcmRequest(req, {
      envGet: (name: string) => denoRuntime.env.get(name),
    })
  );
}

