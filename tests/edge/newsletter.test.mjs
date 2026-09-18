import test from 'node:test';
import assert from 'node:assert/strict';

const environment = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-service', ALLOWED_ORIGINS: 'https://thelittlebakerkitchen.com', RESEND_API_KEY: 'private-resend', EMAIL_FROM: 'TLB <orders@example.com>' };
let handler;
globalThis.Deno = { env: { get: key => environment[key] }, serve: value => { handler = value; } };
await import('../../supabase/functions/newsletter/index.ts');
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
const config = { topic_id: 'topic-newsletter', segment_id: 'segment-newsletter', site_url: 'https://thelittlebakerkitchen.com' };
const userId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const secret = 'a'.repeat(64);
function setup(services = {}, provider) {
  const calls = [];
  provider ||= importProvider();
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body instanceof FormData ? options.body : options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    if (url.endsWith('/auth/v1/user')) return reply({ id: userId });
    if (url.endsWith('/rpc/newsletter_service')) {
      const defaults = {
        configuration: config,
        mark_import_start: { started: true, provider_import_filename: body.p_payload.provider_import_filename || body.p_payload.filename || 'newsletter-lease.csv' },
        mark_import_id: { recorded: true },
      };
      const value = services[body.p_action] ?? defaults[body.p_action] ?? {};
      return value instanceof Response ? value : reply(typeof value === 'function' ? value(body.p_payload) : value);
    }
    if (url.startsWith('https://api.resend.com/')) return provider(url, options, body);
    throw new Error(`Unexpected URL: ${url}`);
  };
  return calls;
}
const request = (body, authenticated = false, origin = 'https://thelittlebakerkitchen.com') => handler(new Request('https://project.supabase.co/functions/v1/newsletter', {
  method: 'POST', headers: { 'Content-Type': 'application/json', origin, ...(authenticated ? { Authorization: 'Bearer signed-user-token' } : {}) }, body: JSON.stringify(body),
}));
const rpcCalls = calls => calls.filter(x => x.url.endsWith('/rpc/newsletter_service'));
const providerCalls = calls => calls.filter(x => x.url.startsWith('https://api.resend.com/'));
const imported = calls => providerCalls(calls).filter(x => x.url.endsWith('/contacts/imports') && x.options.method === 'POST');
const finished = calls => rpcCalls(calls).filter(x => ['finish_confirm', 'finish_unsubscribe'].includes(x.body.p_action));
const fullCounts = { total: 1, updated: 1, created: 0, skipped: 0, failed: 0 };
const active = kind => ({ email: 'test@example.com', operation_id: 'lease', ...(kind === 'confirm' ? { valid: true } : {}) });
const resuming = kind => ({ ...active(kind), resume_import: true, operation_kind: kind, provider_import_id: 'import-existing', provider_import_filename: 'newsletter-lease.csv' });

// Model the actual asynchronous provider import rather than treating its HTTP
// acknowledgement as a stored preference. Tests can independently vary the job
// result, readback, and global suppression while retaining the same contact.
function importProvider({ preference = 'opt_in', desired = null, global = false, globalAfterComplete = global, exists = true, status = 'completed', counts = fullCounts, persist = true, createError = null, importResponse = { id: 'import-created' } } = {}) {
  let expected = desired, contactExists = exists, globalOptOut = global, importPolls = 0;
  return (url, options, body) => {
    const path = new URL(url).pathname;
    if (path === '/contacts/imports' && options.method === 'POST') {
      assert.ok(body instanceof FormData, 'Topic updates must use a multipart import');
      if (createError) throw createError;
      expected = JSON.parse(body.get('topics'))[0].subscription;
      return reply(importResponse);
    }
    if (path.startsWith('/contacts/imports/') && options.method === 'GET') {
      const currentStatus = Array.isArray(status) ? status[Math.min(importPolls++, status.length - 1)] : status;
      if (currentStatus === 'completed') { if (persist && expected) preference = expected; globalOptOut = globalAfterComplete; }
      return reply({ id: path.split('/').at(-1), status: currentStatus, counts });
    }
    if (path.endsWith('/topics') && options.method === 'GET') return reply({ data: [{ id: config.topic_id, subscription: preference }], has_more: false });
    if (path === '/contacts' && options.method === 'POST') { contactExists = true; preference = body.topics[0].subscription; return reply({ id: 'new-contact' }); }
    if (path.includes('/segments/') && options.method === 'POST') return reply({ id: 'segment-membership' });
    if (path.startsWith('/contacts/') && options.method === 'GET') return contactExists ? reply({ id: exists ? 'contact-1' : 'new-contact', unsubscribed: globalOptOut }) : reply({}, 404);
    throw new Error(`Unexpected provider operation: ${options.method} ${url}`);
  };
}

function parseCsv(csv) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const ch = csv[index];
    if (ch === '"') {
      if (quoted && csv[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ',') { row.push(value); value = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[index + 1] === '\n') index++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += ch;
  }
  assert.equal(quoted, false, 'CSV quoting must be complete');
  if (row.length || value) { row.push(value); rows.push(row); }
  return rows;
}

async function assertSingleTopicImport(call, email, subscription) {
  assert.ok(call, 'Expected one contact import');
  assert.ok(call.body instanceof FormData);
  assert.equal(new Headers(call.options.headers).has('Content-Type'), false, 'Fetch must generate the multipart boundary');
  assert.deepEqual([...call.body.keys()].sort(), ['column_map', 'file', 'on_conflict', 'topics']);
  assert.deepEqual(JSON.parse(call.body.get('column_map')), { email: 'email', unsubscribed: 'unsubscribed' });
  assert.equal(call.body.get('on_conflict'), 'upsert');
  assert.deepEqual(JSON.parse(call.body.get('topics')), [{ id: config.topic_id, subscription }]);
  const file = call.body.get('file');
  assert.ok(file instanceof Blob);
  assert.deepEqual(parseCsv(await file.text()), [['email', 'unsubscribed'], [email, '']], 'Exactly one quoted contact row, preserving global unsubscribe');
}

test('capture sends a confirmation with a hashed token, no contact creation, and an idempotency key', async () => {
  const calls = setup({ request: { send: true, request_id: 'request-1' } }, url => reply(url.includes('/topics/') ? { id: config.topic_id, default_subscription: 'opt_out' } : { id: 'email-1' }));
  const response = await request({ action: 'subscribe', email: 'New+tlb@Example.com', source: 'shop_popup' });
  assert.equal(response.status, 200);
  const captured = rpcCalls(calls).find(x => x.body.p_action === 'request').body.p_payload;
  assert.equal(captured.email, 'new+tlb@example.com');
  assert.match(captured.token_hash, /^[0-9a-f]{64}$/);
  assert.match(captured.ip_hash, /^[0-9a-f]{64}$/);
  const sends = providerCalls(calls).filter(x => x.url.endsWith('/emails'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].url, 'https://api.resend.com/emails');
  assert.equal(sends[0].options.headers['Idempotency-Key'], 'newsletter-confirm-request-1');
  const raw = sends[0].body.text.match(/#confirm=([a-f0-9]{64})/)[1];
  assert.notEqual(raw, captured.token_hash);
  assert.equal(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('hex'), captured.token_hash);
  assert.doesNotMatch(await response.text(), /private-|[a-f0-9]{64}/);
});

test('sending-only key cannot send a confirmation that would fail during contact management', async () => {
  const calls = setup({ request: { send: true, request_id: 'request-2' } }, () => reply({ name: 'restricted_api_key' }, 401));
  assert.equal((await request({ action: 'subscribe', email: 'test@example.com' })).status, 503);
  assert.ok(!providerCalls(calls).some(x => x.url.endsWith('/emails')));
});

test('honeypot and throttled signup do not send mail and use generic success', async () => {
  let calls = setup();
  assert.equal((await request({ action: 'subscribe', website: 'bot' })).status, 200);
  assert.equal(calls.length, 0);
  calls = setup({ request: { send: false } });
  const response = await request({ action: 'subscribe', email: 'test@example.com' });
  assert.equal(response.status, 200);
  assert.equal(providerCalls(calls).length, 0);
});

test('origin, malformed email, unknown actions and unauthenticated account actions are rejected', async () => {
  const calls = setup();
  assert.equal((await request({ action: 'subscribe', email: 'x@example.com' }, false, 'https://evil.invalid')).status, 403);
  assert.equal((await request({ action: 'subscribe', email: 'bad@example.com\r\nBcc:x' })).status, 400);
  for (const action of ['status', 'popup_claim', 'popup_seen', 'unsubscribe']) assert.equal((await request({ action })).status, 401);
  assert.equal((await request({ action: 'anything' })).status, 400);
  assert.equal(providerCalls(calls).length, 0);
});

test('popup claims use the verified identity and do not expose internal status fields', async () => {
  const calls = setup({ popup_claim: { show: false, popup_seen: true }, status: { email: 'owner@example.com', status: 'none', popup_seen: true, contact_id: 'private-contact', revision: 9 } });
  assert.deepEqual(await (await request({ action: 'popup_claim', user_id: 'spoofed' }, true)).json(), { show: false, popup_seen: true });
  assert.equal(rpcCalls(calls)[0].body.p_payload.user_id, userId);
  assert.deepEqual(await (await request({ action: 'status' }, true)).json(), { email: 'owner@example.com', status: 'not_subscribed', popup_seen: true });
});

test('invalid and busy confirmation tokens never mutate a provider contact', async () => {
  for (const [state, status] of [[{ valid: false }, 410], [{ busy: true }, 409]]) {
    const calls = setup({ begin_confirm: state });
    assert.equal((await request({ action: 'confirm', token: secret })).status, status);
    assert.equal(providerCalls(calls).length, 0);
  }
  assert.equal((await request({ action: 'confirm', token: 'invalid' })).status, 400);
});

test('new confirmed contacts join only the newsletter segment and explicit topic', async () => {
  const calls = setup({ begin_confirm: active('confirm'), finish_confirm: { status: 'subscribed' } }, importProvider({ exists: false }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 200);
  const created = providerCalls(calls).find(x => x.options.method === 'POST');
  assert.deepEqual(created.body, { email: 'test@example.com', segments: [{ id: config.segment_id }], topics: [{ id: config.topic_id, subscription: 'opt_in' }] });
  const finished = rpcCalls(calls).find(x => x.body.p_action === 'finish_confirm').body.p_payload;
  assert.equal(finished.contact_id, 'new-contact');
  assert.equal(finished.operation_id, 'lease');
  assert.equal(imported(calls).length, 0, 'A new contact still uses direct creation');
});

test('existing contact confirmation imports one escaped row and only the newsletter topic', async () => {
  const email = 'quoted,"name@example.com';
  const calls = setup({ begin_confirm: { ...active('confirm'), email }, finish_confirm: { status: 'subscribed' } }, importProvider({ preference: 'opt_out' }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 200);
  assert.equal(imported(calls).length, 1);
  await assertSingleTopicImport(imported(calls)[0], email, 'opt_in');
  assert.equal(providerCalls(calls).some(x => x.options.method === 'PATCH'), false);
  const markerIndex = calls.findIndex(x => x.body?.p_action === 'mark_import_start');
  const postIndex = calls.indexOf(imported(calls)[0]);
  const savedIdIndex = calls.findIndex(x => x.body?.p_action === 'mark_import_id');
  assert.ok(markerIndex >= 0 && markerIndex < postIndex && savedIdIndex > postIndex, 'Durable intent precedes upload and returned job id is retained');
  assert.equal(finished(calls)[0].body.p_payload.import_terminal, true);
  assert.equal(finished(calls)[0].body.p_payload.contact_id, 'contact-1');
});

test('an already-correct topic never creates an unnecessary import', async () => {
  for (const [action, preference] of [['confirm', 'opt_in'], ['unsubscribe', 'opt_out']]) {
    const calls = setup({ [`begin_${action}`]: active(action) }, importProvider({ preference }));
    const response = await request({ action, ...(action === 'confirm' ? { token: secret } : {}) }, action === 'unsubscribe');
    assert.equal(response.status, 200);
    assert.equal(imported(calls).length, 0);
    assert.equal(rpcCalls(calls).some(x => ['mark_import_start', 'mark_import_id'].includes(x.body.p_action)), false);
    assert.equal(finished(calls).length, 1);
  }
});

test('global opt-out is preserved with a useful error and a released unused lease', async () => {
  const calls = setup({ begin_confirm: { valid: true, email: 'test@example.com', operation_id: 'lease' } }, () => reply({ id: 'contact-1', unsubscribed: true }));
  const response = await request({ action: 'confirm', token: secret });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /opted out of all/);
  assert.equal(providerCalls(calls).length, 1);
  assert.ok(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'));
  assert.ok(!rpcCalls(calls).some(x => x.body.p_action === 'finish_confirm'));
});

test('account unsubscribe opts out only the newsletter and preserves contact/global settings', async () => {
  const calls = setup({ begin_unsubscribe: active('unsubscribe'), finish_unsubscribe: { status: 'unsubscribed' } }, importProvider({ global: true }));
  assert.deepEqual(await (await request({ action: 'unsubscribe', email: 'other@example.com' }, true)).json(), { ok: true, status: 'unsubscribed' });
  assert.deepEqual(rpcCalls(calls).find(x => x.body.p_action === 'begin_unsubscribe').body.p_payload, { user_id: userId });
  const mutations = providerCalls(calls).filter(x => x.options.method !== 'GET');
  assert.equal(mutations.length, 1);
  await assertSingleTopicImport(mutations[0], 'test@example.com', 'opt_out');
  assert.equal(finished(calls)[0].body.p_payload.import_terminal, true);
});

test('provider HTTP 200 without a stored opt-out never reports success or completes the database operation', async () => {
  const calls = setup({ begin_unsubscribe: active('unsubscribe') }, importProvider({ preference: 'opt_in', persist: false }));
  const response = await request({ action: 'unsubscribe' }, true);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /could not be verified/);
  assert.equal(finished(calls).length, 0);
  assert.equal(imported(calls).length, 1);
  assert.equal(rpcCalls(calls).find(x => x.body.p_action === 'cancel_operation')?.body.p_payload.import_terminal, true, 'A terminal no-op releases the durable import fence');
});

test('provider HTTP 200 without a stored opt-in never confirms subscription', async () => {
  const calls = setup({ begin_confirm: active('confirm') }, importProvider({ preference: 'opt_out', persist: false }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 503);
  assert.equal(finished(calls).length, 0);
  assert.equal(imported(calls).length, 1);
  assert.equal(rpcCalls(calls).find(x => x.body.p_action === 'cancel_operation')?.body.p_payload.import_terminal, true, 'A terminal no-op releases the durable import fence');
});

test('a transient read failure after completed import keeps its durable record for verification retry', async () => {
  const implementation = importProvider();
  let completed = false;
  const calls = setup({ begin_unsubscribe: active('unsubscribe') }, (url, options, body) => {
    if (url.includes('/contacts/imports/') && options.method === 'GET') completed = true;
    else if (completed && options.method === 'GET') return reply({ error: 'private-read-failure' }, 503);
    return implementation(url, options, body);
  });
  const response = await request({ action: 'unsubscribe' }, true);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-read-failure/);
  assert.equal(imported(calls).length, 1);
  assert.equal(finished(calls).length, 0);
  assert.equal(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'), false);
});

test('a concurrent global opt-out after completed import prevents local confirmation', async () => {
  const calls = setup({ begin_confirm: active('confirm') }, importProvider({ preference: 'opt_out', globalAfterComplete: true }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 409);
  assert.equal(imported(calls).length, 1);
  assert.equal(finished(calls).length, 0);
  const pollIndex = calls.findIndex(x => x.url.includes('/contacts/imports/') && x.options.method === 'GET');
  const finalGlobalRead = calls.findLastIndex(x => /\/contacts\/(?:contact-1|test%40example.com)$/.test(x.url) && x.options.method === 'GET');
  assert.ok(finalGlobalRead > pollIndex, 'Re-read current global suppression after the async import');
});

test('failed and partially applied imports never finish and cancel only with terminal evidence', async () => {
  for (const result of [
    { status: 'failed', counts: fullCounts },
    { status: 'completed', counts: { ...fullCounts, updated: 0, failed: 1 } },
    { status: 'completed', counts: { ...fullCounts, updated: 0, skipped: 1 } },
    { status: 'completed', counts: { ...fullCounts, created: 1 } },
    { status: 'completed', counts: { ...fullCounts, total: 2 } },
    { status: 'completed', counts: { ...fullCounts, updated: 0 } },
  ]) {
    const calls = setup({ begin_unsubscribe: active('unsubscribe') }, importProvider(result));
    assert.equal((await request({ action: 'unsubscribe' }, true)).status, 503);
    assert.equal(finished(calls).length, 0);
    const cancellation = rpcCalls(calls).find(x => x.body.p_action === 'cancel_operation');
    assert.ok(cancellation, `Terminal failed result must release its operation: ${JSON.stringify(result)}`);
    assert.equal(cancellation.body.p_payload.import_terminal, true);
  }
});

test('an import still in progress stays fenced without creating another upload', async () => {
  const calls = setup({ begin_unsubscribe: resuming('unsubscribe') }, importProvider({ status: 'in_progress', desired: 'opt_out' }));
  assert.equal((await request({ action: 'unsubscribe' }, true)).status, 503);
  assert.equal(imported(calls).length, 0);
  assert.equal(finished(calls).length, 0);
  assert.equal(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'), false);
  assert.ok(providerCalls(calls).some(x => x.url.endsWith('/contacts/imports/import-existing')));
});

test('queued and in-progress jobs resume to completion without a duplicate import', async () => {
  let begins = 0;
  const calls = setup({ begin_unsubscribe: () => ++begins === 1 ? resuming('unsubscribe') : { done: true } }, importProvider({ status: ['queued', 'in_progress', 'completed'], desired: 'opt_out' }));
  assert.equal((await request({ action: 'unsubscribe' }, true)).status, 200);
  assert.equal(imported(calls).length, 0);
  assert.equal(finished(calls).length, 1);
  assert.equal(finished(calls)[0].body.p_payload.import_terminal, true);
  assert.equal(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'), false);
  assert.equal(providerCalls(calls).filter(x => x.url.endsWith('/contacts/imports/import-existing')).length, 3);
});

test('completed old unsubscribe import is drained before beginning a new confirmation', async () => {
  let begins = 0;
  const calls = setup({ begin_confirm: () => ++begins === 1 ? resuming('unsubscribe') : { ...active('confirm'), operation_id: 'new-confirm' } }, importProvider({ preference: 'opt_in', desired: 'opt_out' }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 200);
  assert.equal(begins, 2);
  assert.equal(imported(calls).length, 1, 'Only the new intent may create an import');
  assert.deepEqual(finished(calls).map(x => x.body.p_action), ['finish_unsubscribe', 'finish_confirm']);
  assert.ok(finished(calls).every(x => x.body.p_payload.import_terminal === true));
  const firstFinish = calls.indexOf(finished(calls)[0]);
  const secondBegin = calls.findLastIndex(x => x.body?.p_action === 'begin_confirm');
  assert.ok(firstFinish < secondBegin, 'Prior job must become terminal before a new begin');
});

test('status resumes the retained provider job then reloads authoritative account status', async () => {
  let reads = 0;
  const calls = setup({
    status: () => ++reads === 1
      ? { email: 'test@example.com', status: 'subscribed', revision: 4, popup_seen: true, provider_import_pending: true }
      : { email: 'test@example.com', status: 'unsubscribed', revision: 5, popup_seen: true },
    resume_import: resuming('unsubscribe'),
  }, importProvider({ desired: 'opt_out' }));
  const response = await request({ action: 'status' }, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { email: 'test@example.com', status: 'unsubscribed', popup_seen: true });
  assert.equal(reads, 2);
  assert.equal(imported(calls).length, 0);
  assert.deepEqual(rpcCalls(calls).find(x => x.body.p_action === 'resume_import').body.p_payload, { email: 'test@example.com' });
  assert.equal(finished(calls)[0].body.p_action, 'finish_unsubscribe');
});

test('an ambiguous import creation keeps its durable marker and never retries a second upload', async () => {
  const calls = setup({ begin_unsubscribe: active('unsubscribe') }, importProvider({ createError: new TypeError('private-provider-network-detail') }));
  const response = await request({ action: 'unsubscribe' }, true);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-provider/);
  assert.equal(imported(calls).length, 1);
  assert.ok(rpcCalls(calls).some(x => x.body.p_action === 'mark_import_start'));
  assert.equal(finished(calls).length, 0);
  assert.equal(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'), false);

  const retry = setup({ begin_unsubscribe: { ...resuming('unsubscribe'), provider_import_id: null } });
  const retryResponse = await request({ action: 'unsubscribe' }, true);
  assert.equal(retryResponse.status, 503);
  assert.match((await retryResponse.json()).error, /verification|contact TLB|help/i);
  assert.equal(providerCalls(retry).length, 0, 'An unknown accepted job cannot be safely replaced');
  assert.equal(imported(retry).length, 0);
  assert.equal(finished(retry).length, 0);
  assert.equal(rpcCalls(retry).some(x => x.body.p_action === 'cancel_operation'), false);
});

test('an upload acknowledgement without a job id never polls or finishes an assumed success', async () => {
  const calls = setup({ begin_unsubscribe: active('unsubscribe') }, importProvider({ importResponse: { object: 'contact_import' } }));
  assert.equal((await request({ action: 'unsubscribe' }, true)).status, 503);
  assert.equal(imported(calls).length, 1);
  assert.equal(finished(calls).length, 0);
  assert.equal(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'), false);
});

test('rejected durable import marker prevents any provider upload', async () => {
  const calls = setup({ begin_unsubscribe: active('unsubscribe'), mark_import_start: { started: false } });
  assert.ok((await request({ action: 'unsubscribe' }, true)).status >= 400);
  assert.equal(imported(calls).length, 0);
  assert.equal(finished(calls).length, 0);
});

test('a rejected job-id record retains its marker and cannot finish as a successful update', async () => {
  const calls = setup({ begin_unsubscribe: active('unsubscribe'), mark_import_id: { recorded: false } });
  assert.equal((await request({ action: 'unsubscribe' }, true)).status, 503);
  assert.equal(imported(calls).length, 1);
  assert.equal(finished(calls).length, 0);
  assert.equal(rpcCalls(calls).some(x => x.body.p_action === 'cancel_operation'), false);
});

test('provider opt-out is reconciled into account preferences with a revision fence', async () => {
  const calls = setup({ status: { email: 'test@example.com', status: 'subscribed', revision: 4, popup_seen: true }, reconcile: { updated: true } }, url => url.includes('/topics') ? reply({ data: [{ id: config.topic_id, subscription: 'opt_out' }], has_more: false }) : reply({ id: 'contact-1', unsubscribed: false }));
  assert.equal((await (await request({ action: 'status' }, true)).json()).status, 'unsubscribed');
  assert.deepEqual(rpcCalls(calls).find(x => x.body.p_action === 'reconcile').body.p_payload, { email: 'test@example.com', status: 'unsubscribed', revision: 4 });
});

test('confirmation replay cannot opt a provider-unsubscribed address back in', async () => {
  const calls = setup({ begin_confirm: { valid: true, already_subscribed: true, email: 'test@example.com' } }, () => reply({ id: 'contact-1', unsubscribed: true }));
  assert.equal((await request({ action: 'confirm', token: secret })).status, 410);
  assert.ok(providerCalls(calls).every(x => x.options.method === 'GET'));
});
