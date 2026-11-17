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

  // 1. Authenticate caller (internal bearer secret or service role)
  const authHeader = req.headers.get('Authorization') ?? '';
  const expectedSecret = deps.envGet('FCM_FUNCTION_SECRET') || deps.envGet('SUPABASE_SERVICE_ROLE_KEY');
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!expectedSecret || bearerToken !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid function secret' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse and validate JSON request body
  let payload: FcmDispatchPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

  const fetchImpl = deps.fetchImpl ?? fetch;

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

