import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import {
  base64UrlEncode,
  createGoogleJwtAssertion,
  getGoogleOAuth2AccessToken,
  sendFcmHttpV1Message,
  handleFcmRequest,
} from './index.ts';

// Generate a test RSA 2048 keypair for cryptographic testing
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('base64UrlEncode encodes strings and bytes without padding or plus/slash', () => {
  const encoded = base64UrlEncode('hello world! 123456');
  assert.match(encoded, /^[a-zA-Z0-9_-]+$/);
  assert.ok(!encoded.includes('='));
  assert.ok(!encoded.includes('+'));
  assert.ok(!encoded.includes('/'));
});

test('createGoogleJwtAssertion creates a valid 3-part RS256 JWT', async () => {
  const clientEmail = 'test-service-account@smart-rt-15e23.iam.gserviceaccount.com';
  const assertion = await createGoogleJwtAssertion(clientEmail, privateKey);

  const parts = assertion.split('.');
  assert.equal(parts.length, 3, 'JWT must have header, payload, and signature');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  assert.equal(header.alg, 'RS256');
  assert.equal(header.typ, 'JWT');

  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(payload.iss, clientEmail);
  assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
  assert.ok(payload.exp > payload.iat);
});

test('getGoogleOAuth2AccessToken exchanges assertion with Google OAuth2', async () => {
  const mockAccessToken = 'ya29.mock_oauth2_access_token_12345';
  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.method, 'POST');
    assert.ok(options.body.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'));
    return new Response(JSON.stringify({ access_token: mockAccessToken, expires_in: 3600 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const token = await getGoogleOAuth2AccessToken(
    'test@project.iam.gserviceaccount.com',
    privateKey,
    mockFetch
  );
  assert.equal(token, mockAccessToken);
});

test('sendFcmHttpV1Message sends payload to FCM v1 messages:send', async () => {
  let capturedBody = null;
  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/smart-rt-15e23/messages:send');
    assert.equal(options.headers['Authorization'], 'Bearer mock_token');
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ name: 'projects/smart-rt-15e23/messages/0:12345' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await sendFcmHttpV1Message(
    'smart-rt-15e23',
    'mock_token',
    'device_token_abc123',
    'Pengumuman RT',
    'Kerja bakti hari Minggu jam 07:00.',
    { target_url: 'https://smart-rt-nine.vercel.app/resident' },
    mockFetch
  );

  assert.equal(result.success, true);
  assert.equal(result.status, 200);
  assert.equal(capturedBody.message.token, 'device_token_abc123');
  assert.equal(capturedBody.message.notification.title, 'Pengumuman RT');
  assert.equal(capturedBody.message.android.notification.channel_id, 'smartrt_resident_notifications');
});

test('sendFcmHttpV1Message flags stale token when FCM returns UNREGISTERED or 404', async () => {
  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: 404,
          message: 'Requested entity was not found.',
          status: 'NOT_FOUND',
          details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }],
        },
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await sendFcmHttpV1Message(
    'smart-rt-15e23',
    'mock_token',
    'expired_token_xyz',
    'Test',
    'Test Body',
    {},
    mockFetch
  );

  assert.equal(result.success, false);
  assert.equal(result.status, 404);
  assert.equal(result.shouldDeactivateToken, true);
});

test('handleFcmRequest rejects unauthorized requests missing secret', async () => {
  const req = new Request('https://edge.supabase.co/functions/v1/send-fcm-notification', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer wrong_secret' },
    body: JSON.stringify({}),
  });

  const res = await handleFcmRequest(req, {
    envGet: (key) => (key === 'FCM_FUNCTION_SECRET' ? 'correct_secret' : undefined),
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error, /Unauthorized/);
});

test('handleFcmRequest validates tenant, queries device tokens, and dispatches FCM', async () => {
  const mockEnv = {
    FCM_FUNCTION_SECRET: 'test_secret',
    SUPABASE_URL: 'https://szghujzhiyndeuhepsax.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_key',
    FIREBASE_PROJECT_ID: 'smart-rt-15e23',
    FIREBASE_CLIENT_EMAIL: 'test@smart-rt-15e23.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privateKey,
  };

  const mockTokens = [
    { id: 'token-uuid-1', user_id: 'user-uuid-1', fcm_token: 'live_token_1' },
    { id: 'token-uuid-2', user_id: 'user-uuid-1', fcm_token: 'stale_token_2' },
  ];

  let deactivationPatchCalled = false;

  const mockFetch = async (url, options) => {
    // 1. Database query for tokens
    if (url.includes('/rest/v1/user_device_tokens') && (!options?.method || options.method === 'GET')) {
      return new Response(JSON.stringify(mockTokens), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Database patch to deactivate stale tokens
    if (url.includes('/rest/v1/user_device_tokens') && options?.method === 'PATCH') {
      deactivationPatchCalled = true;
      return new Response(null, { status: 204 });
    }

    // 3. Google OAuth token exchange
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'mock_oauth_token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. FCM v1 dispatch
    if (url.includes('messages:send')) {
      const body = JSON.parse(options.body);
      if (body.message.token === 'live_token_1') {
        return new Response(JSON.stringify({ name: 'msg/1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        // stale token
        return new Response(
          JSON.stringify({ error: { message: 'UNREGISTERED', code: 404 } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = new Request('https://edge.supabase.co/functions/v1/send-fcm-notification', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer test_secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tenant_id: 'tenant-uuid-1234',
      recipient_user_ids: ['user-uuid-1'],
      title: 'Iuran Warga Berhasil',
      body: 'Pembayaran iuran bulan ini telah diverifikasi.',
      data: { type: 'payment', reference_id: 'pay-123' },
    }),
  });

  const res = await handleFcmRequest(req, {
    envGet: (k) => mockEnv[k],
    fetchImpl: mockFetch,
  });

  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.ok, true);
  assert.equal(result.total_recipients, 1);
  assert.equal(result.total_tokens, 2);
  assert.equal(result.success_count, 1);
  assert.equal(result.failure_count, 1);
  assert.equal(result.deactivated_tokens, 1);
  assert.equal(deactivationPatchCalled, true);
});

test('handleFcmRequest processes outbox batch via single-use nonce and resolves admin/resident paths', async () => {
  const mockEnv = {
    FCM_FUNCTION_SECRET: 'test_secret',
    FIREBASE_PROJECT_ID: 'smart-rt-15e23',
    FIREBASE_CLIENT_EMAIL: 'fcm@smart-rt-15e23.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privateKey,
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role',
  };

  const recordedResults = [];
  const fcmDispatchedPaths = [];
  const sampleComplaintId = '11111111-1111-4111-8111-111111111111';

  const mockFetch = async (url, options) => {
    if (url.includes('/rpc/consume_notification_dispatch_nonce')) {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify(body.p_nonce === 'valid-cron-nonce-1234567890abcdef'), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/rpc/claim_pending_notification_outbox_batch')) {
      return new Response(JSON.stringify([
        {
          id: 'outbox-adm-1',
          tenant_id: 'tenant-1',
          recipient_user_id: 'staff-1',
          event_type: 'complaint.reply',
          reference_type: 'complaint',
          reference_id: sampleComplaintId,
          target_scope: 'admin',
          title: 'Balasan warga',
          body: 'Mohon ditindaklanjuti',
          claim_token: 'claim-tok-1',
        },
        {
          id: 'outbox-res-1',
          tenant_id: 'tenant-1',
          recipient_user_id: 'warga-1',
          event_type: 'complaint.reply',
          reference_type: 'complaint',
          reference_id: sampleComplaintId,
          target_scope: 'resident',
          title: 'Balasan pengurus',
          body: 'Sedang diproses',
          claim_token: 'claim-tok-2',
        },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (url.includes('user_device_tokens')) {
      if (url.includes('staff-1')) {
        return new Response(JSON.stringify([{ id: 'tok-adm', user_id: 'staff-1', fcm_token: 'fcm-adm' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-oauth-tok', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('messages:send')) {
      const body = JSON.parse(options.body);
      fcmDispatchedPaths.push(body.message.data?.path);
      return new Response(JSON.stringify({ name: 'msg/adm-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/rpc/record_notification_outbox_result')) {
      recordedResults.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const req = new Request('https://edge.supabase.co/functions/v1/send-fcm-notification', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Outbox-Dispatch-Nonce': 'valid-cron-nonce-1234567890abcdef',
    },
    body: JSON.stringify({ mode: 'process_outbox', limit: 20 }),
  });

  const res = await handleFcmRequest(req, {
    envGet: (k) => mockEnv[k],
    fetchImpl: mockFetch,
  });

  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'process_outbox');
  assert.equal(result.claimed_count, 2);
  assert.equal(result.sent_count, 2);
  assert.deepEqual(fcmDispatchedPaths, [`/pengaduan/${sampleComplaintId}`]);
  assert.equal(recordedResults.length, 2);
  assert.equal(recordedResults[0].p_claim_token, 'claim-tok-1');
  assert.equal(recordedResults[1].p_claim_token, 'claim-tok-2');
});

