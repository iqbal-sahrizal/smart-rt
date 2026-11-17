import test from 'node:test';
import assert from 'node:assert/strict';
import { handleActivateInvitedResident } from './index.ts';

const MOCK_ENV = {
  SUPABASE_URL: 'https://mock.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key',
};

test('creates confirmed auth user immediately for valid invitation without sending verification email', async () => {
  let adminUserPayload = null;
  const mockFetch = async (url, options) => {
    if (url.includes('/rpc/get_resident_invitation_claim_target')) {
      return new Response(JSON.stringify({
        valid: true,
        reason: 'valid',
        email: 'warga.baru@example.id',
        resident_name: 'Budi Santoso',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/auth/v1/admin/users')) {
      adminUserPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: 'user-1', email: 'warga.baru@example.id' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const req = new Request('https://edge.supabase.co/functions/v1/activate-invited-resident', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'a'.repeat(64), password: 'Password123!' }),
  });

  const res = await handleActivateInvitedResident(req, { envGet: (k) => MOCK_ENV[k], fetchImpl: mockFetch });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, status: 'created' });
  assert.equal(adminUserPayload.email, 'warga.baru@example.id');
  assert.equal(adminUserPayload.email_confirm, true);
  assert.equal(adminUserPayload.user_metadata.full_name, 'Budi Santoso');
});

test('rejects invalid/expired/redeemed invitation without touching GoTrue Admin API', async () => {
  let adminCalled = false;
  for (const reason of ['not_found', 'expired', 'redeemed', 'revoked']) {
    const mockFetch = async (url) => {
      if (url.includes('/rpc/get_resident_invitation_claim_target')) {
        return new Response(JSON.stringify({ valid: false, reason }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      adminCalled = true;
      return new Response('{}', { status: 500 });
    };

    const req = new Request('https://edge.supabase.co/functions/v1/activate-invited-resident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'b'.repeat(64), password: 'Password123!' }),
    });

    const res = await handleActivateInvitedResident(req, { envGet: (k) => MOCK_ENV[k], fetchImpl: mockFetch });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, reason);
  }
  assert.equal(adminCalled, false);
});

test('returns existing_user without overwriting password when auth user already exists', async () => {
  const mockFetch = async (url) => {
    if (url.includes('/rpc/get_resident_invitation_claim_target')) {
      return new Response(JSON.stringify({
        valid: true,
        reason: 'valid',
        email: 'existing@example.id',
        resident_name: 'Siti',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/auth/v1/admin/users')) {
      return new Response(JSON.stringify({ error_code: 'email_exists', msg: 'A user with this email address has already been registered' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const req = new Request('https://edge.supabase.co/functions/v1/activate-invited-resident', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'c'.repeat(64), password: 'AnyPassword123!' }),
  });

  const res = await handleActivateInvitedResident(req, { envGet: (k) => MOCK_ENV[k], fetchImpl: mockFetch });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: 'existing_user' });
});

test('rejects malformed token and short password before database calls', async () => {
  let fetched = false;
  const mockFetch = async () => { fetched = true; return new Response('{}', { status: 200 }); };

  const badTokenReq = new Request('https://edge.supabase.co/functions/v1/activate-invited-resident', {
    method: 'POST',
    body: JSON.stringify({ token: '../evil', password: 'Password123!' }),
  });
  const res1 = await handleActivateInvitedResident(badTokenReq, { envGet: (k) => MOCK_ENV[k], fetchImpl: mockFetch });
  assert.equal(res1.status, 400);

  const shortPwdReq = new Request('https://edge.supabase.co/functions/v1/activate-invited-resident', {
    method: 'POST',
    body: JSON.stringify({ token: 'd'.repeat(64), password: 'short' }),
  });
  const res2 = await handleActivateInvitedResident(shortPwdReq, { envGet: (k) => MOCK_ENV[k], fetchImpl: mockFetch });
  assert.equal(res2.status, 400);
  assert.equal(fetched, false);
});

