// Run with Node 24: node tests/edge/run.mjs
// Provider calls are mocked; these tests do not send email or activate services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

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

test('payment emails use each saved deadline and avoid outdated duration claims for legacy orders', () => {
  const fresh = payload('order_submitted');
  fresh.order.created_at = '2026-09-12T09:00:00Z';
  fresh.order.payment_deadline = '2026-09-12T09:15:00Z';
  const legacy = payload('order_submitted');
  legacy.order.created_at = fresh.order.created_at;
  legacy.order.payment_deadline = '2026-09-12T10:00:00Z';
  for (const output of ['html', 'text']) {
    assert.match(renderEmail(fresh)[output], /5:15\s*PM/);
    assert.match(renderEmail(legacy)[output], /6:00\s*PM/);
    const expired = renderEmail({ ...legacy, event_type: 'order_expired' })[output];
    assert.match(expired, /before your payment-proof deadline/);
    assert.doesNotMatch(expired, /60-minute|15-minute/);
  }
});

test('delivery emails preserve the saved zone description, line breaks and fee while escaping HTML', () => {
  const delivery = payload('order_submitted');
  Object.assign(delivery.order, {
    method: 'delivery',
    delivery_zone_name: 'North <Zone>',
    delivery_zone_description: 'One motorcycle included.\nIf <b>one is not enough</b>, we will contact you & agree on transport.',
    delivery_cents: 12000,
    total_cents: 72000,
  });
  delivery.settings.delivery_zone_name = 'Changed zone';
  delivery.settings.delivery_zone_description = 'New terms must not replace saved instructions.';
  for (const event_type of ['order_submitted', 'payment_approved', 'out_for_delivery', 'order_edited']) {
    const result = renderEmail({ ...delivery, event_type });
    assert.match(result.text, /Delivery zone: North <Zone>/);
    assert.ok(result.text.includes(delivery.order.delivery_zone_description));
    assert.match(result.html, /Delivery zone: North &lt;Zone&gt;/);
    assert.match(result.html, /One motorcycle included\.<br>If &lt;b&gt;one is not enough&lt;\/b&gt;, we will contact you &amp; agree on transport\./);
    assert.doesNotMatch(result.html, /<b>one is not enough<\/b>/);
    assert.doesNotMatch(result.text, /Changed zone|New terms/);
    assert.match(result.text, /Delivery fee: ₱120\.00/);
    assert.match(result.text, /Current order total: ₱720\.00/);
  }
});

test('legacy and blank delivery zone snapshots omit zone text without using current settings', () => {
  for (const snapshot of [{}, { delivery_zone_name: '', delivery_zone_description: '' }, { delivery_zone_name: ' ', delivery_zone_description: '\n ' }]) {
    const delivery = payload('order_submitted');
    Object.assign(delivery.order, { method: 'delivery' }, snapshot);
    delivery.settings.delivery_zone_name = 'Current zone';
    delivery.settings.delivery_zone_description = 'Current description';
    const result = renderEmail(delivery);
    for (const output of [result.text, result.html]) {
      assert.doesNotMatch(output, /Delivery zone:|Current zone|Current description|undefined|null/);
      assert.match(output, /Delivery window:/);
    }
  }
});

test('pickup emails suppress delivery zone details even if stale delivery snapshot fields are present', () => {
  const pickup = payload('ready_for_pickup');
  pickup.order.delivery_zone_name = 'Delivery-only zone';
  pickup.order.delivery_zone_description = 'Delivery-only transport instructions';
  pickup.order.pickup_instructions = 'Pickup line one\nPickup line two';
  const result = renderEmail(pickup);
  assert.match(result.text, /Pickup line one\nPickup line two/);
  assert.match(result.html, /Pickup line one<br>Pickup line two/);
  for (const output of [result.text, result.html]) {
    assert.doesNotMatch(output, /Delivery-only|Delivery zone:|Delivery window:/);
  }
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
      assert.equal(body.p_payload.payment_reference, 'TEST-123');
      return reply({ id: orderId, payment_status: 'under_review' });
    }
    assert.ok(String(url).includes('/object/payment-proofs/')); actions.push('storage'); return reply({ Key: 'saved' });
  };
  const response = await upload(request('proof-upload', form()));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).order.payment_status, 'under_review');
  assert.deepEqual(actions, ['authorize_upload', 'storage', 'commit_proof']);
});

test('proof images can be submitted with an omitted or blank payment reference', async () => {
  for (const reference of [null, '', ' \n\t ', '  BANK-6789  ']) {
    const actions = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('/rpc/')) {
        const body = JSON.parse(options.body); actions.push(body.p_action);
        if (body.p_action === 'authorize_upload') return reply({ allowed: true });
        assert.equal(body.p_action, 'commit_proof');
        assert.equal(body.p_payload.payment_reference, reference?.trim() || '');
        assert.match(body.p_payload.path, new RegExp(`^${orderId}/[a-f0-9-]+\\.png$`));
        return reply({ id: orderId, payment_status: 'under_review' });
      }
      assert.ok(String(url).includes('/object/payment-proofs/'));
      actions.push('storage'); return reply({ Key: 'saved' });
    };
    const body = form();
    if (reference === null) body.delete('payment_reference');
    else body.set('payment_reference', reference);
    const response = await upload(request('proof-upload', body));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).order.payment_status, 'under_review');
    assert.deepEqual(actions, ['authorize_upload', 'storage', 'commit_proof']);
  }
});

test('optional references do not make proof images optional or bypass image validation', async () => {
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error('Unexpected network request'); };
  const invalidForms = [
    [body => body.delete('file'), 400, /Choose one image/],
    [body => body.set('file', 'receipt.png'), 400, /Choose one image/],
    [body => body.set('file', new File(['%PDF-1.4'], 'receipt.png', { type: 'image/png' })), 415, /image/i],
    [body => body.set('file', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'receipt.png', { type: 'image/png' })), 413, /5 MB/],
    [body => body.set('payment_reference', 'R'.repeat(201)), 400, /Payment reference/],
    [body => body.set('payment_reference', new File([png], 'receipt.png', { type: 'image/png' })), 400, /Payment reference must be text/],
  ];
  for (const [change, status, message] of invalidForms) {
    const body = form(); body.delete('payment_reference'); change(body);
    const response = await upload(request('proof-upload', body));
    assert.equal(response.status, status);
    assert.match((await response.json()).error, message);
  }
  assert.equal(providerCalls, 0);
});

test('proof without a payment reference still requires authorization before storage', async () => {
  const actions = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).includes('/rpc/'));
    const body = JSON.parse(options.body); actions.push(body.p_action);
    assert.equal(body.p_action, 'authorize_upload');
    return reply({ allowed: false });
  };
  const body = form(); body.delete('payment_reference');
  assert.equal((await upload(request('proof-upload', body))).status, 403);
  assert.deepEqual(actions, ['authorize_upload']);
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

test('staff review email uses an authenticated dashboard link and never renders customer tokens or proof paths', () => {
  const review=payload('order_review_required');
  Object.assign(review.order,{buyer_name:'Customer <script>alert(1)</script>',proof_path:'private/proof.png'});
  delete review.order.access_token;
  const rendered=renderEmail(review);
  for(const content of [rendered.html,rendered.text]){
    assert.match(content,/An order is ready for review/);
    assert.match(content,/TLB-TEST/);
    assert.match(content,/₱600\.00/);
    assert.match(content,/https:\/\/preview\.test\/manage\.html/);
    assert.doesNotMatch(content,/token=|shop\.html|private\/proof|Test instructions|Reference did not match/);
  }
  assert.match(rendered.html,/Customer &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html,/<script>/);
  assert.match(rendered.html,/<html lang="en">/);
  review.order.access_token='private-guest-token';
  assert.doesNotMatch(JSON.stringify(renderEmail(review)),/private-guest-token/);
  for(const site_url of ['http://preview.test','javascript:alert(1)','https://user:password@preview.test']){
    assert.throws(()=>renderEmail({...review,settings:{...review.settings,site_url}}),/HTTPS/);
  }
});

test('staff notifications are individually addressed and use their own stable provider event key', async () => {
  const events=[];
  const review=payload('order_review_required');delete review.order.access_token;
  const row={id:orderId,lease_token:userId,event_key:'review:order:2:staff-address-hash',to_email:'staff@example.test',subject:'Order ready for review · TLB-TEST',payload:review,first_attempt_at:new Date().toISOString()};
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes('resend.com')){
      const sent=JSON.parse(options.body);
      assert.deepEqual(sent.to,['staff@example.test']);
      assert.equal(options.headers['Idempotency-Key'],row.event_key);
      assert.match(sent.html,/manage\.html/);assert.match(sent.text,/payment proof/);
      assert.doesNotMatch(options.body,/private-guest-token/);
      events.push('provider');return reply({id:'review-provider-id'});
    }
    const body=JSON.parse(options.body);events.push(body.p_action);
    if(body.p_action==='claim_emails')return reply([row]);
    if(body.p_action==='prepare_email')return reply(row);
    return reply({});
  };
  const response=await worker(new Request('https://worker.test',{method:'POST',headers:{'x-worker-token':environment.EMAIL_WORKER_TOKEN}}));
  assert.equal((await response.json()).accepted,1);
  assert.deepEqual(events,['maintenance','claim_emails','prepare_email','provider','email_sent']);
});

test('staff review email lists all saved products and payment components in HTML and plain text',()=>{
  const review=payload('order_review_required');
  Object.assign(review.order,{buyer_name:'Test customer',method:'delivery',items:[
    {name:'Nori <pouch>',quantity:2,selection_labels:[{group:'Flavor',label:'Cheese & spice',quantity:1,surcharge_cents:2000}],unit_price_cents:15000,line_total_cents:30000},
    {name:'Ube cake',quantity:1,selection_labels:['8 inch'],unit_price_cents:225000,line_total_cents:225000},
  ],subtotal_cents:255000,discount_cents:25500,delivery_cents:7500,total_cents:237000,promo_code:'DEMO10'});
  delete review.order.access_token;
  const rendered=renderEmail(review);
  for(const content of [rendered.html,rendered.text]){
    for(const expected of ['Products ordered','Payment breakdown','2 × Nori','1 × Ube cake','8 inch','₱150.00','₱300.00','₱2,250.00','₱2,550.00','−₱255.00','₱75.00','₱2,370.00','Discount (DEMO10)'])assert.ok(content.includes(expected),expected);
    assert.doesNotMatch(content,/Paid|Balance due|undefined|null/);
  }
  assert.match(rendered.html,/Nori &lt;pouch&gt;/);
  assert.match(rendered.html,/Cheese &amp; spice/);
  assert.match(rendered.text,/Cheese & spice/);
});

test('staff pickup breakdown shows zero fees and discount without a promo or false paid amount',()=>{
  const review=payload('order_review_required');
  Object.assign(review.order,{discount_cents:0,delivery_cents:0,total_cents:66000});
  const rendered=renderEmail(review);
  assert.match(rendered.text,/Subtotal: ₱660\.00\nDiscount: ₱0\.00\nDelivery fee: ₱0\.00\nOrder total: ₱660\.00/);
  assert.doesNotMatch(rendered.text,/Discount \(|Amount paid|Balance due/);
});

test('legacy queued review messages retain the exact deployed body for provider idempotency retries',()=>{
  const legacy={event_type:'order_review_required',order:{id:'legacy-id',reference:'TLB-LEGACY',buyer_name:'Test customer',fulfillment_date:'2026-09-19',method:'pickup',total_cents:13000},settings:{site_url:'https://preview.test',shop_name:'TLB Kitchen'}};
  // Captured from deployed email-worker v10 before the details migration.
  assert.equal(createHash('sha256').update(JSON.stringify(renderEmail(legacy))).digest('hex'),'2e2de63180a8577ffc504891433aa57866340a709531d471000430cb3abf3de4');
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
