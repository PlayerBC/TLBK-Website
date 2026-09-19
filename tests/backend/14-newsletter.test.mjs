import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const { as, ids, scalar } = state.harness;
  const hash = (value = randomBytes(32).toString('hex')) => createHash('sha256').update(value).digest('hex');
  const call = (action, payload = {}) => as(null, async () => (
    await db.query('select public.newsletter_service($1, $2::jsonb) as result', [action, JSON.stringify(payload)])
  ).rows[0].result, 'service_role');
  const request = (email = `newsletter-${randomUUID()}@example.test`, extras = {}) => {
    const input = { email, token_hash: hash(), ip_hash: hash(), source: 'footer', ...extras };
    return call('request', input).then(result => ({ ...input, ...result }));
  };
  const confirm = async (pending) => {
    const operation = await call('begin_confirm', { token_hash: pending.token_hash });
    assert.equal(operation.valid, true);
    const unsubscribe_token_hash = hash();
    await call('finish_confirm', { ...operation, contact_id: randomUUID(), unsubscribe_token_hash });
    return { ...pending, ...operation, unsubscribe_token_hash };
  };
  const subscriber = async email => (await db.query('select * from tlb.newsletter_subscribers where email=$1', [email])).rows[0];

  await check('newsletter data and service are inaccessible to browser roles, and private tables have RLS', async () => {
    for (const user of [null, ids.customer, ids.owner]) {
      await assert.rejects(as(user, () => db.query("select public.newsletter_service('configuration', '{}')")), /permission denied/i);
      for (const table of ['newsletter_config', 'newsletter_subscribers', 'newsletter_events', 'newsletter_popup_seen']) {
        await assert.rejects(as(user, () => db.query(`select * from tlb.${table}`)), /permission denied/i);
      }
    }
    const tables = (await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tlb' and c.relname in ('newsletter_config','newsletter_subscribers','newsletter_events','newsletter_popup_seen')")).rows;
    assert.equal(tables.length, 4);
    assert.ok(tables.every(row => row.relrowsecurity));
    assert.equal((await call('configuration')).consent_version, 'tlb-newsletter-v2-single-opt-in');
  })();

  await check('newsletter requests normalize email, retain only token hashes, and enforce minute and rolling hourly limits', async () => {
    const email = `Normalize-${randomUUID()}@Example.Test`;
    const first = await request(` ${email} `);
    assert.equal(first.send, true);
    assert.equal(first.email, email.toLowerCase());
    const row = await subscriber(first.email);
    assert.equal(row.confirmation_token_hash, first.token_hash);
    assert.equal(row.status, 'pending');
    assert.ok(new Date(row.confirmation_expires_at) > new Date(Date.now() + 23 * 3600000));
    const duplicate = await request(email);
    assert.equal(duplicate.send, false);
    assert.equal((await subscriber(first.email)).confirmation_token_hash, first.token_hash);
    for (let i = 0; i < 2; i++) {
      await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1 and event='requested'", [first.email]);
      assert.equal((await request(email)).send, true);
    }
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1 and event='requested'", [first.email]);
    assert.equal((await request(email)).send, false);
    await assert.rejects(request('not-an-email'), /email/i);
    await assert.rejects(request(undefined, { token_hash: 'raw-short-token' }), /token/i);
  })();

  await check('newsletter signup applies a shared per-IP limit and global cap', async () => {
    const ip_hash = hash();
    for (let i = 0; i < 20; i++) assert.equal((await request(undefined, { ip_hash })).send, true);
    assert.equal((await request(undefined, { ip_hash })).send, false);
    const used = await scalar("select count(*)::int from tlb.newsletter_events where event='requested' and occurred_at>clock_timestamp()-interval '1 hour'");
    for (let i = used; i < 100; i++) assert.equal((await request()).send, true);
    assert.equal((await request()).send, false);
    // Advance the fixture history so subsequent cases do not share the global cap.
    await db.exec("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 hours' where event='requested'");
  })();

  await check('expired and superseded newsletter links cannot confirm', async () => {
    const expired = await request();
    await db.query("update tlb.newsletter_subscribers set confirmation_expires_at=clock_timestamp()-interval '1 second' where email=$1", [expired.email]);
    assert.deepEqual(await call('begin_confirm', { token_hash: expired.token_hash }), { valid: false });
    const old = await request();
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1", [old.email]);
    const replacement = await request(old.email);
    assert.equal(replacement.send, true);
    assert.deepEqual(await call('begin_confirm', { token_hash: old.token_hash }), { valid: false });
    await confirm(replacement);
  })();

  await check('only confirmed newsletter consent subscribes, and replay is idempotent while subscribed', async () => {
    const pending = await request();
    const subscribed = await confirm(pending);
    const row = await subscriber(pending.email);
    assert.equal(row.status, 'subscribed');
    assert.equal(row.confirmation_token_hash, null);
    assert.equal(row.confirmed_token_hash, pending.token_hash);
    assert.equal(row.unsubscribe_token_hash, subscribed.unsubscribe_token_hash);
    assert.ok(row.confirmed_at);
    assert.equal((await call('begin_confirm', { token_hash: pending.token_hash })).already_subscribed, true);
    assert.equal((await request(pending.email)).send, false);
    assert.equal(await scalar("select count(*)::int from tlb.newsletter_events where email=$1 and event='confirmed'", [pending.email]), 1);
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1 and event='requested'", [pending.email]);
    const fresh = await request(pending.email);
    assert.equal(fresh.send, true, 'Fresh double opt-in permits recovery from a provider-side unsubscribe');
    assert.equal((await subscriber(pending.email)).status, 'subscribed', 'Request alone never changes consent');
    assert.notEqual(fresh.token_hash, pending.token_hash);
  })();

  await check('unsubscribe invalidates old confirmation and a new request cannot silently opt back in', async () => {
    const subscribed = await confirm(await request());
    const operation = await call('begin_unsubscribe', { token_hash: subscribed.unsubscribe_token_hash });
    await call('finish_unsubscribe', operation);
    assert.equal((await subscriber(subscribed.email)).status, 'unsubscribed');
    assert.deepEqual(await call('begin_confirm', { token_hash: subscribed.token_hash }), { valid: false });
    const repeated = await call('begin_unsubscribe', { token_hash: subscribed.unsubscribe_token_hash });
    assert.ok(repeated.operation_id, 'Even a local opt-out reconciles with the provider after ambiguous failures');
    await call('finish_unsubscribe', repeated);
    await db.query("update tlb.newsletter_events set occurred_at=clock_timestamp()-interval '2 minutes' where email=$1 and event='requested'", [subscribed.email]);
    const resubscribe = await request(subscribed.email);
    assert.equal(resubscribe.send, true);
    assert.equal((await subscriber(subscribed.email)).status, 'unsubscribed');
    const user_id = randomUUID();
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())', [user_id, subscribed.email]);
    assert.equal((await call('status', { user_id })).status, 'pending', 'Outstanding re-consent remains cancellable after reload');
    assert.equal((await call('popup_claim', { user_id })).show, false);
    assert.deepEqual(await call('begin_confirm', { token_hash: subscribed.token_hash }), { valid: false });
    await confirm(resubscribe);
    assert.equal((await subscriber(subscribed.email)).status, 'subscribed');
  })();

  await check('newsletter operations exclude opposite mutations and reject stale finish operations', async () => {
    const pending = await request('customer@example.test');
    const confirmation = await call('begin_confirm', { token_hash: pending.token_hash });
    assert.equal((await call('begin_confirm', { token_hash: pending.token_hash })).busy, true);
    assert.equal((await call('begin_unsubscribe', { user_id: ids.customer })).busy, true);
    assert.equal((await request(pending.email)).send, false);
    assert.equal((await call('cancel_operation', { ...confirmation, operation_id: randomUUID() })).cancelled, false);
    assert.equal((await call('cancel_operation', confirmation)).cancelled, true);
    await assert.rejects(call('finish_confirm', { ...confirmation, unsubscribe_token_hash: hash() }), /operation/i);
    const active = await call('begin_confirm', { token_hash: pending.token_hash });
    await db.query("update tlb.newsletter_subscribers set operation_expires_at=clock_timestamp()-interval '1 second' where email=$1", [pending.email]);
    await assert.rejects(call('finish_confirm', { ...active, unsubscribe_token_hash: hash() }), /operation/i);
    const subscribed = await confirm(pending);
    const unsubscribe = await call('begin_unsubscribe', { user_id: ids.customer });
    assert.deepEqual(await call('begin_confirm', { token_hash: pending.token_hash }), { valid: false });
    assert.equal((await call('begin_unsubscribe', { user_id: ids.customer })).busy, true);
    await call('finish_unsubscribe', unsubscribe);
    await assert.rejects(call('finish_confirm', { ...subscribed, unsubscribe_token_hash: hash() }), /operation/i);
  })();

  await check('account newsletter preferences resolve only verified auth email and never trust payload email', async () => {
    const status = await call('status', { user_id: ids.customer, email: 'stranger@example.test' });
    assert.equal(status.email, 'customer@example.test');
    assert.equal(status.status, 'unsubscribed');
    assert.equal((await call('status', { user_id: ids.stranger })).status, 'none');
    await assert.rejects(call('status', { user_id: ids.unverified }), /verified/i);
    await assert.rejects(call('status', { user_id: randomUUID() }), /verified/i);
    assert.equal((await call('begin_unsubscribe', { user_id: ids.stranger })).done, true);
  })();

  await check('provider reconciliation records opt-out only and rejects stale or leased observations', async () => {
    const pending = await request('stranger@example.test');
    await confirm(pending);
    const status = await call('status', { user_id: ids.stranger });
    assert.equal((await call('reconcile', { ...status, status: 'unsubscribed', revision: status.revision - 1 })).updated, false);
    assert.equal((await call('reconcile', { ...status, status: 'subscribed' })).updated, false);
    const operation = await call('begin_unsubscribe', { user_id: ids.stranger });
    assert.equal((await call('reconcile', { ...status, status: 'unsubscribed' })).updated, false);
    await call('cancel_operation', operation);
    const current = await call('status', { user_id: ids.stranger });
    assert.equal((await call('reconcile', { ...current, status: 'unsubscribed' })).updated, true);
    assert.equal((await subscriber(pending.email)).status, 'unsubscribed');
    assert.deepEqual(await call('begin_confirm', { token_hash: pending.token_hash }), { valid: false });
  })();

  await check('newsletter popup is atomically claimed only once per account and suppresses pending and confirmed subscribers', async () => {
    assert.equal((await call('popup_claim', { user_id: ids.owner })).show, true);
    for (let i = 0; i < 3; i++) assert.equal((await call('popup_claim', { user_id: ids.owner })).show, false);
    await call('popup_seen', { user_id: ids.staff });
    assert.equal((await call('popup_claim', { user_id: ids.staff })).show, false);
    assert.equal((await call('status', { user_id: ids.owner })).popup_seen, true);
    await confirm(await request('unverified@example.test'));
    await db.query('update auth.users set email_confirmed_at=clock_timestamp() where id=$1', [ids.unverified]);
    assert.equal((await call('popup_claim', { user_id: ids.unverified })).show, false);
    assert.equal(await scalar('select count(*)::int from tlb.newsletter_popup_seen where user_id=$1', [ids.owner]), 1);
    const pendingUser = randomUUID();
    const email = `pending-${pendingUser}@example.test`;
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())', [pendingUser, email]);
    await request(email);
    assert.equal((await call('popup_claim', { user_id: pendingUser })).show, false);
    assert.equal((await call('status', { user_id: pendingUser })).popup_seen, true);
  })();

  await check('newsletter migration replays without resetting consent, popup history, or ordering functions', async () => {
    const migration = await readFile(new URL('../../supabase/migrations/20260918134354_newsletter_subscriptions.sql', import.meta.url), 'utf8');
    const before = (await db.query('select * from tlb.newsletter_subscribers order by email')).rows;
    const events = await scalar('select count(*)::int from tlb.newsletter_events');
    const orderFunction = await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)");
    const serviceFunction = await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)");
    const newsletterFunction = await scalar("select pg_get_functiondef('public.newsletter_service(text,jsonb)'::regprocedure)");
    await db.exec(migration);
    // Keep subsequent newsletter upgrades installed after replaying this older migration.
    await db.exec(newsletterFunction);
    assert.deepEqual((await db.query('select * from tlb.newsletter_subscribers order by email')).rows, before);
    assert.equal(await scalar('select count(*)::int from tlb.newsletter_events'), events);
    assert.equal(await scalar("select pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure)"), orderFunction);
    assert.equal(await scalar("select pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure)"), serviceFunction);
    assert.equal((await call('popup_claim', { user_id: ids.owner })).show, false);
    assert.equal(await scalar("select has_function_privilege('service_role','public.newsletter_service(text,jsonb)','execute')"), true);
    assert.equal(await scalar("select has_function_privilege('anon','public.newsletter_service(text,jsonb)','execute')"), false);
  })();
}
