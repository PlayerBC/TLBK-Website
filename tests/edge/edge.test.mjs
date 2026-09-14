// Run with Node 24: node tests/edge/run.mjs
// Provider calls are mocked; these tests do not send email or activate services.
import test from 'node:test';
import assert from 'node:assert/strict';

const environment = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'private-test-key',
  SUPABASE_ANON_KEY: 'public-test-key',
  ALLOWED_ORIGINS: 'https://preview.test',
  EMAIL_WORKER_TOKEN: 'a-private-test-worker-token-longer-than-32-chars',
  RESEND_API_KEY: 'private-resend-test-key',
  EMAIL_FROM: 'TLB Kitchen <orders@mail.test>',
};
let registered;
globalThis.Deno = { env: { get: key => environment[key] }, serve: handler => { registered = handler; } };
const { imageType } = await import('../../supabase/functions/_shared/images.ts');
const { renderEmail } = await import('../../supabase/functions/_shared/emails.ts');
await import('../../supabase/functions/proof-upload/index.ts');
const upload = registered;
await import('../../supabase/functions/proof-url/index.ts');
const proofUrl = registered;
await import('../../supabase/functions/email-worker/index.ts');
const worker = registered;
const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSsAAAAASUVORK5CYII=', 'base64'));
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (path, body, authorization = 'public-test-key') => new Request(`https://project.supabase.co/functions/v1/${path}`, {
  method: 'POST', headers: { Origin: 'https://preview.test', Authorization: `Bearer ${authorization}` }, body,
});
const form = (kind = 'proof', file = new File([png], 'photo.png', { type: 'image/png' })) => {
  const result = new FormData();
  result.set('kind', kind); result.set('file', file); result.set('order_id', orderId);
  result.set('token', 'guest-token'); result.set('payment_reference', 'TEST-123');
  return result;
};
const payload = event => ({ event_type: event, order: {
  id: orderId, reference: 'TLB-TEST', access_token: 'private-guest-token', fulfillment_date: '2026-09-15',
  payment_deadline: '2026-09-12T10:00:00Z', method: 'pickup', buyer: { email: 'owner-controlled@test.invalid' },
  items: [{ name: '<script>unsafe</script>', quantity: 1, selection_labels: [{ group: 'Flavour', label: 'Classic', quantity: 4, surcharge_cents: 0 }, { group: 'Flavour', label: 'Matcha', quantity: 2, surcharge_cents: 3000 }], line_total_cents: 66000 }],
  subtotal_cents: 66000, discount_cents: 6000, delivery_cents: 0, total_cents: 60000,
  history: [{ action: 'payment_rejected', reason: 'Reference did not match' }],
}, settings: { site_url: 'https://preview.test', shop_name: 'TLB Kitchen', payment_instructions: 'Test instructions', contact_email: 'help@test.invalid', pickup_address: 'Test location' } });

test('file contents determine type; forged, unsupported and oversized input is rejected', () => {
  assert.equal(imageType(png).mime, 'image/png');
  for (const invalid of [new TextEncoder().encode('%PDF-1.4'), new TextEncoder().encode('<svg></svg>'), png.slice(0, 12)]) {
    assert.throws(() => imageType(invalid));
  }
  assert.throws(() => imageType(new Uint8Array(5 * 1024 * 1024 + 1)));
});

test('all order messages contain secure fragment link and escaped content', () => {
  for (const event of ['order_submitted', 'payment_approved', 'payment_rejected', 'order_cancelled', 'order_expired', 'fulfillment_reminder', 'ready_for_pickup', 'out_for_delivery', 'order_edited']) {
    const result = renderEmail(payload(event));
    assert.ok(result.text.includes('TLB-TEST'));
    assert.ok(result.text.includes(`shop.html#order=${orderId}&token=private-guest-token`));
    assert.ok(!result.html.includes('<script>unsafe</script>'));
    assert.ok(!result.text.includes('[object Object]'));
    assert.ok(result.text.includes('Matcha × 2'));
  }
  assert.match(renderEmail(payload('payment_rejected')).text, /before making any further payment/);
  assert.match(renderEmail(payload('order_cancelled')).text, /does not confirm a refund/);
  assert.ok(!renderEmail(payload('order_edited')).text.includes('Payment instructions:'));
});

test('unlisted origins and unauthenticated product uploads never reach database or storage', async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
  const untrusted = new Request('https://project.supabase.co/functions/v1/proof-upload', { method: 'POST', headers: { Origin: 'https://untrusted.test' }, body: form() });
  assert.equal((await upload(untrusted)).status, 403);
  assert.equal((await upload(request('proof-upload', form('product')))).status, 401);
});

test('guest proof authorizes before storage and commits with server-chosen private path', async () => {
  const actions = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/rpc/')) {
      const body = JSON.parse(options.body); actions.push(body.p_action);
      assert.equal(body.p_payload.user_id, null);
      if (body.p_action === 'authorize_upload') return reply({ allowed: true });
      assert.match(body.p_payload.path, new RegExp(`^${orderId}/[a-f0-9-]+\\.png$`));
      return reply({ id: orderId, payment_status: 'under_review' });
    }
    assert.ok(String(url).includes('/object/payment-proofs/')); actions.push('storage'); return reply({ Key: 'saved' });
  };
  const response = await upload(request('proof-upload', form()));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).order.payment_status, 'under_review');
  assert.deepEqual(actions, ['authorize_upload', 'storage', 'commit_proof']);
});

test('proof race failure removes uploaded object and never reports success', async () => {
  let removed = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/rpc/')) {
      const body = JSON.parse(options.body);
      return body.p_action === 'authorize_upload' ? reply({ allowed: true }) : reply({ message: 'Proof deadline expired' }, 400);
    }
    if (options.method === 'DELETE') removed = JSON.parse(options.body).prefixes.length === 1;
    return reply({});
  };
  assert.equal((await upload(request('proof-upload', form()))).status, 400);
  assert.equal(removed, true);
});

test('admin proof identity is verified remotely and signed access lasts five minutes', async () => {
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/auth/v1/user')) return reply({ id: userId });
    if (String(url).includes('/rpc/')) {
      const body = JSON.parse(options.body); assert.equal(body.p_payload.user_id, userId);
      return reply({ path: `${orderId}/image.png` });
    }
    assert.equal(JSON.parse(options.body).expiresIn, 300);
    return reply({ signedURL: `/object/sign/payment-proofs/${orderId}/image.png?token=short-lived` });
  };
  const response = await proofUrl(request('proof-url', JSON.stringify({ order_id: orderId, user_id: 'spoofed' }), 'valid-session'));
  assert.equal(response.status, 200);
  assert.match((await response.json()).url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign/);
});

test('worker requires its own secret and skips invalidated reminders', async () => {
  let providerCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('resend.com')) { providerCalls++; return reply({ id: 'sent' }); }
    const body = JSON.parse(options.body);
    if (body.p_action === 'maintenance') return reply({ expired: 0 });
    if (body.p_action === 'claim_emails') return reply([{ id: orderId, lease_token: userId, event_key: 'reminder:test' }]);
    if (body.p_action === 'prepare_email') return reply({ skip: true });
    throw new Error('Unexpected action');
  };
  assert.equal((await worker(new Request('https://worker.test', { method: 'POST' }))).status, 401);
  const response = await worker(new Request('https://worker.test', { method: 'POST', headers: { 'x-worker-token': environment.EMAIL_WORKER_TOKEN } }));
  assert.equal((await response.json()).skipped, 1);
  assert.equal(providerCalls, 0);
});

test('worker uses stable idempotency key and only records provider acceptance after API success', async () => {
  const events = [];
  const row = { id: orderId, lease_token: userId, event_key: 'submitted:test-order', to_email: 'owner-controlled@test.invalid', subject: 'Test', payload: payload('order_submitted'), first_attempt_at: new Date().toISOString() };
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('resend.com')) {
      assert.equal(options.headers['Idempotency-Key'], row.event_key); events.push('provider'); return reply({ id: 'provider-test-id' });
    }
    const body = JSON.parse(options.body); events.push(body.p_action);
    if (body.p_action === 'claim_emails') return reply([row]);
    if (body.p_action === 'prepare_email') return reply(row);
    if (body.p_action === 'email_sent') assert.equal(body.p_payload.provider_id, 'provider-test-id');
    return reply({});
  };
  const response = await worker(new Request('https://worker.test', { method: 'POST', headers: { 'x-worker-token': environment.EMAIL_WORKER_TOKEN } }));
  assert.equal((await response.json()).accepted, 1);
  assert.deepEqual(events, ['maintenance', 'claim_emails', 'prepare_email', 'provider', 'email_sent']);
});
