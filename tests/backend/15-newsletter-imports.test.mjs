import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const { as, scalar, ids } = state.harness;
  const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
  const call = (action, payload = {}) => as(null, async () => (
    await db.query('select public.newsletter_service($1,$2::jsonb) as result', [action, JSON.stringify(payload)])
  ).rows[0].result, 'service_role');
  const row = async email => (await db.query('select * from tlb.newsletter_subscribers where email=$1', [email])).rows[0];
  const expireLease = email => db.query("update tlb.newsletter_subscribers set operation_expires_at=clock_timestamp()-interval '1 second' where email=$1", [email]);
  const fixture = async () => {
    const user_id = randomUUID(), email = `import-${user_id}@example.test`, token_hash = hash(), contact_id = randomUUID();
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())', [user_id,email]);
    assert.equal((await call('request', { email, token_hash, source: 'account', ip_hash: hash() })).send, true);
    const operation = await call('begin_confirm', { token_hash });
    const started = await call('mark_import_start', { ...operation, contact_id });
    assert.equal(started.started, true);
    return { ...operation, ...started, user_id, token_hash, contact_id };
  };
  const attach = async operation => {
    const provider_import_id = randomUUID();
    assert.deepEqual(await call('mark_import_id', { ...operation, provider_import_id }), { recorded: true });
    return { ...operation, provider_import_id };
  };
  const complete = operation => call('finish_confirm', {
    ...operation, import_terminal: true, unsubscribe_token_hash: hash(),
  });

  await check('newsletter import reservation is durable, idempotent, and tied to a verified provider contact', async () => {
    const operation = await fixture();
    assert.equal(operation.provider_import_filename, `tlb-newsletter-${operation.operation_id}.csv`);
    assert.equal(operation.operation_kind, 'confirm');
    assert.equal(operation.provider_import_id, null);
    assert.ok(operation.provider_import_started_at);
    assert.equal((await call('mark_import_start', operation)).started, false);
    assert.equal((await row(operation.email)).provider_contact_id, operation.contact_id);
    assert.equal((await call('status', { user_id: operation.user_id })).provider_import_pending, true);
    await assert.rejects(call('mark_import_start', { ...operation, contact_id: randomUUID() }), /contact changed/i);
    await assert.rejects(call('mark_import_start', { ...operation, operation_id: randomUUID() }), /operation/i);
    await assert.rejects(call('mark_import_start', { ...operation, contact_id: '' }), /contact ID/i);
  })();

  await check('expired request leases cannot replace an unknown import or its confirmation token', async () => {
    const operation = await fixture();
    const before = await row(operation.email);
    await expireLease(operation.email);
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1 and event='requested'", [operation.email]);
    assert.equal((await call('request', { email: operation.email, token_hash: hash(), source: 'website', ip_hash: hash() })).send, false);
    const blocked = await row(operation.email);
    assert.equal(blocked.operation_id, before.operation_id);
    assert.equal(blocked.confirmation_token_hash, operation.token_hash);
    assert.equal(blocked.provider_import_filename, before.provider_import_filename);
    await assert.rejects(call('mark_import_id', { ...operation, provider_import_id: randomUUID() }), /expired/i);
    const resumed = await call('begin_unsubscribe', { user_id: operation.user_id });
    assert.equal(resumed.resume_import, true);
    assert.equal(resumed.operation_id, operation.operation_id);
    assert.equal(resumed.operation_kind, 'confirm');
    assert.equal(resumed.provider_import_id, null, 'Unknown POST result stays unknown; no new job may be started');
    assert.equal(resumed.contact_id, operation.contact_id);
    assert.equal((await row(operation.email)).confirmation_token_hash, operation.token_hash);
    assert.deepEqual(await call('begin_confirm', { token_hash: operation.token_hash }), { busy: true });
    assert.deepEqual(await call('resume_import', { email: operation.email }), { busy: true });
  })();

  await check('known import recovery keeps identity across token expiry and validates the recorded job ID', async () => {
    const operation = await attach(await fixture());
    await assert.rejects(call('mark_import_id', { ...operation, provider_import_id: randomUUID() }), /cannot be replaced/i);
    await assert.rejects(call('mark_import_id', { ...operation, provider_import_filename: 'different.csv' }), /identity/i);
    assert.deepEqual(await call('mark_import_id', operation), { recorded: true });
    await expireLease(operation.email);
    await db.query("update tlb.newsletter_subscribers set confirmation_expires_at=clock_timestamp()-interval '1 second' where email=$1", [operation.email]);
    assert.deepEqual(await call('begin_confirm', { token_hash: hash() }), { valid: false });
    const resumed = await call('begin_confirm', { token_hash: operation.token_hash });
    assert.equal(resumed.resume_import, true, 'Existing authorized work can be drained after the original link expires');
    assert.equal(resumed.provider_import_id, operation.provider_import_id);
    assert.equal(resumed.operation_id, operation.operation_id);
    assert.equal(resumed.operation_kind, 'confirm');
    assert.ok(new Date((await row(operation.email)).operation_expires_at) > new Date());
    await expireLease(operation.email);
    assert.equal((await call('resume_import', { email: operation.email })).operation_id, operation.operation_id);
  })();

  await check('pending imports require terminal proof before cancellation or completion', async () => {
    const operation = await attach(await fixture());
    for (const import_terminal of [undefined, false, 'true']) {
      assert.deepEqual(await call('cancel_operation', { ...operation, import_terminal }), { cancelled: false });
      await assert.rejects(call('finish_confirm', { ...operation, import_terminal, unsubscribe_token_hash: hash() }), /terminal/i);
    }
    assert.equal((await row(operation.email)).provider_import_id, operation.provider_import_id);
    assert.deepEqual(await call('cancel_operation', { ...operation, import_terminal: true }), { cancelled: true });
    const cancelled = await row(operation.email);
    for (const field of ['provider_import_id','provider_import_filename','provider_import_started_at','operation_id']) assert.equal(cancelled[field], null);
    assert.equal(cancelled.confirmation_token_hash, operation.token_hash, 'A known failed import may be retried using its still-valid confirmation');
    assert.deepEqual(await call('resume_import', { email: operation.email }), { none: true });
    assert.deepEqual(await call('resume_import', { email: 'missing@example.test' }), { none: true });
  })();

  await check('a recovered confirm finishes before an opposite unsubscribe starts, with all job fields cleared', async () => {
    const operation = await attach(await fixture());
    await expireLease(operation.email);
    const resumed = await call('begin_unsubscribe', { user_id: operation.user_id });
    assert.equal(resumed.operation_kind, 'confirm');
    await assert.rejects(call('finish_unsubscribe', { ...resumed, import_terminal: true }), /operation/i);
    await complete(resumed);
    let current = await row(operation.email);
    assert.equal(current.status, 'subscribed');
    for (const field of ['provider_import_id','provider_import_filename','provider_import_started_at','operation_id']) assert.equal(current[field], null);
    const unsubscribe = await call('begin_unsubscribe', { user_id: operation.user_id });
    assert.notEqual(unsubscribe.operation_id, operation.operation_id);
    const marked = await call('mark_import_start', { ...unsubscribe, contact_id: operation.contact_id });
    const job = await attach(marked);
    assert.equal(marked.operation_kind, 'unsubscribe');
    await expireLease(operation.email);
    const recovered = await call('resume_import', { email: operation.email });
    assert.equal(recovered.operation_id, job.operation_id);
    assert.equal(recovered.operation_kind, 'unsubscribe');
    await call('finish_unsubscribe', { ...recovered, import_terminal: true });
    current = await row(operation.email);
    assert.equal(current.status, 'unsubscribed');
    for (const field of ['provider_import_id','provider_import_filename','provider_import_started_at','operation_id','confirmed_token_hash']) assert.equal(current[field], null);
    assert.equal((await call('status', { user_id: operation.user_id })).provider_import_pending, false);
  })();

  await check('reconciliation and untrusted RPC callers cannot discard pending provider work', async () => {
    const operation = await attach(await fixture());
    await complete(operation);
    const unsubscribe = await call('begin_unsubscribe', { user_id: operation.user_id });
    const pending = await call('mark_import_start', { ...unsubscribe, contact_id: operation.contact_id });
    await expireLease(operation.email);
    const status = await call('status', { user_id: operation.user_id });
    assert.deepEqual(await call('reconcile', { ...status, status: 'unsubscribed' }), { updated: false });
    assert.equal((await row(operation.email)).provider_import_filename, pending.provider_import_filename);
    for (const user of [null, ids.customer, ids.owner]) {
      await assert.rejects(as(user, () => db.query("select public.newsletter_service('resume_import',$1::jsonb)", [JSON.stringify({ email: operation.email })])), /permission denied/i);
    }
    const migration = await readFile(new URL('../../supabase/migrations/20260918165306_newsletter_durable_imports.sql', import.meta.url), 'utf8');
    const before = await row(operation.email);
    const installed = await scalar("select pg_get_functiondef('public.newsletter_service(text,jsonb)'::regprocedure)");
    await db.exec(migration);
    await db.exec(installed); // Preserve later signup upgrades when replaying this historical migration.
    assert.deepEqual(await row(operation.email), before);
    assert.equal(await scalar("select has_function_privilege('service_role','public.newsletter_service(text,jsonb)','execute')"), true);
    assert.equal(await scalar("select has_function_privilege('authenticated','public.newsletter_service(text,jsonb)','execute')"), false);
  })();
}
