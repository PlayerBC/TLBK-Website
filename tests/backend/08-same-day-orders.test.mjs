import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export default async function ({ db, check, state }) {
  const h = state.harness;
  const { api, ids, checkout, fixture, inventory, item, remaining, order, action, proof } = h;
  // Match the normalized function source even when Git checks SQL out as CRLF.
  const migration = (await readFile(new URL('../../supabase/migrations/20260915161342_product_same_day_orders.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const signatures = ['tlb.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)', 'public.shop_api(text,jsonb,text)'];
  const definition = signature => h.scalar('select pg_get_functiondef($1::regprocedure)', [signature]);
  const patches = [...migration.matchAll(/\('([^']+)',\s+\$old\$([\s\S]*?)\$old\$,\s+\$new\$([\s\S]*?)\$new\$\)/g)];
  assert.equal(patches.length, 5, 'Upgrade fixture must cover all guarded replacements.');
  const beforeUpgrade = (signature, source) => patches.filter(p => p[1] === signature).reduceRight((text, p) => {
    const normalized = text.replace(/\r\n/g, '\n');
    assert.ok(normalized.includes(p[3]), 'Installed function must contain the migration anchor.');
    return normalized.replace(p[3], p[2]);
  }, source);
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(o) order by o.id) from tlb.orders o) as orders,
    (select jsonb_agg(to_jsonb(a) order by a.order_id,a.product_id,a.date) from tlb.allocations a) as allocations,
    (select jsonb_agg(to_jsonb(e) order by e.id) from tlb.outbox e) as emails,
    (select jsonb_agg(to_jsonb(p) order by p.id) from tlb.payments p) as payments,
    (select jsonb_agg(to_jsonb(p) order by p.id) from tlb.products p) as products,
    (select data from tlb.settings where id) as settings`)).rows[0];
  const quoteAt = async (product, date, submitted, extra = {}) => (await db.query(
    'select tlb.calculate_quote($1::jsonb,null,null,false,$2::timestamptz) as result',
    [JSON.stringify(checkout(product, date, extra)), submitted],
  )).rows[0].result;
  const settings = changes => api('save_settings', { settings: changes }, ids.owner);
  const saveProduct = product => api('save_product', { product }, ids.owner);
  const oldSettings = (await api('admin_bootstrap', {}, ids.owner)).settings;
  const baseSettings = {
    production_weekdays: [0, 1, 2, 3, 4, 5, 6], fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6],
    cutoff_time: null, nonproduction_dates: [], blocked_dates: [], pickup_blocked_dates: [], delivery_blocked_dates: [], paused: false,
  };
  await settings(baseSettings);
  try {
    await check('same-day product option defaults off, requires owner-managed booleans and zero production days', async () => {
      const { product } = await fixture(5, { lead_days: 0 });
      assert.equal(product.allow_same_day, false);
      const enabled = await saveProduct({ ...product, allow_same_day: true });
      assert.equal(enabled.allow_same_day, true);
      assert.equal((await api('catalog')).products.find(p => p.id === product.id).allow_same_day, true);
      for (const invalid of ['true', 'false', 1, 0, null, {}, []]) {
        await assert.rejects(saveProduct({ ...enabled, allow_same_day: invalid }), /Same-day ordering must be enabled or disabled/);
      }
      for (const lead_days of [1, 365]) {
        await assert.rejects(saveProduct({ ...enabled, lead_days }), /Same-day products must have 0 full production days/);
      }
      for (const user of [null, ids.customer, ids.staff]) {
        await assert.rejects(api('save_product', { product: { ...enabled, allow_same_day: false } }, user), /owner|permission|authorized|sign in/i);
      }
      assert.equal((await saveProduct({ ...enabled, allow_same_day: false, lead_days: 2 })).allow_same_day, false);
      const legacy = { ...product }; delete legacy.allow_same_day;
      assert.equal((await saveProduct(legacy)).allow_same_day, false);
    })();

    await check('same-day option observes the existing Manila cutoff exactly and permits next-day stock after cutoff', async () => {
      await settings({ cutoff_time: '12:00' });
      const { product } = await fixture(5, { lead_days: 0, allow_same_day: true });
      for (const date of ['2026-09-15', '2026-09-16']) await inventory(product, date, 5);
      for (const method of ['pickup', 'delivery']) {
        const extra = { method, address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' } };
        assert.equal((await quoteAt(product, '2026-09-15', '2026-09-15T03:59:59Z', extra)).earliest_date, '2026-09-15');
        for (const submitted of ['2026-09-15T04:00:00Z', '2026-09-15T15:59:59Z']) {
          await assert.rejects(quoteAt(product, '2026-09-15', submitted, extra), /same-day order cutoff has passed/);
          assert.equal((await quoteAt(product, '2026-09-16', submitted, extra)).earliest_date, '2026-09-16');
        }
      }
      await settings({ cutoff_time: null });
      assert.equal((await quoteAt(product, '2026-09-15', '2026-09-15T15:59:59Z')).earliest_date, '2026-09-15');
    })();

    await check('same-day readiness uses Manila midnight, allows nonproduction days and retains the three-calendar-month horizon', async () => {
      const { product } = await fixture(5, { lead_days: 0, allow_same_day: true });
      await settings({ cutoff_time: null, nonproduction_dates: ['2026-10-01'] });
      for (const date of ['2026-09-30', '2026-10-01', '2026-12-31', '2027-01-01']) await inventory(product, date, 5);
      assert.equal((await quoteAt(product, '2026-09-30', '2026-09-30T15:59:59Z')).earliest_date, '2026-09-30');
      await assert.rejects(quoteAt(product, '2026-09-30', '2026-09-30T16:00:00Z'), /Past fulfillment dates/);
      assert.equal((await quoteAt(product, '2026-10-01', '2026-09-30T16:00:00Z')).earliest_date, '2026-10-01');
      assert.equal((await quoteAt(product, '2026-12-31', '2026-09-30T16:00:00Z')).earliest_date, '2026-10-01');
      await assert.rejects(quoteAt(product, '2027-01-01', '2026-09-30T16:00:00Z'), /current month or the next two months/);
      await settings({ nonproduction_dates: [] });
    })();

    await check('products without opt-in require tomorrow or their production lead date, including mixed baskets', async () => {
      await settings({ cutoff_time: '12:00' });
      const same = (await fixture(5, { lead_days: 0, allow_same_day: true })).product;
      const zero = (await fixture(5, { lead_days: 0 })).product;
      const prepared = (await fixture(5, { lead_days: 1 })).product;
      for (const p of [same, zero, prepared]) for (const date of ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) await inventory(p, date, 5);
      assert.equal((await quoteAt(zero, '2026-09-16', '2026-09-15T11:59:59+08:00')).earliest_date, '2026-09-16');
      assert.equal((await quoteAt(zero, '2026-09-16', '2026-09-15T12:00:00+08:00')).earliest_date, '2026-09-16');
      assert.equal((await quoteAt(prepared, '2026-09-17', '2026-09-15T12:00:00+08:00')).earliest_date, '2026-09-17');
      for (const other of [zero, prepared]) for (const items of [[item(same), item(other)], [item(other), item(same)]]) {
        await assert.rejects(quoteAt(same, '2026-09-15', '2026-09-15T11:00:00+08:00', { items }), /not available for same-day/);
      }
      assert.equal((await quoteAt(same, '2026-09-17', '2026-09-15T12:00:00+08:00', { items: [item(same), item(prepared)] })).earliest_date, '2026-09-17');
      await settings({ cutoff_time: null });
    })();

    await check('public quote and create reject mixed or forged same-day eligibility without reserving stock or queuing email', async () => {
      const today = await h.day(0), yesterday = await h.day(-1);
      const same = (await fixture(5, { lead_days: 0, allow_same_day: true })).product;
      const zero = (await fixture(5, { lead_days: 0 })).product;
      for (const p of [same, zero]) for (const date of [today, yesterday]) await inventory(p, date, 5);
      const before = await snapshot();
      for (const user of [null, ids.customer, ids.owner]) {
        for (const items of [[item(zero)], [item(same), item(zero)]]) {
          const payload = checkout(zero, today, {
            items: items.map(i => ({ ...i, allow_same_day: true, lead_days: 0 })),
            allow_same_day: true, admin: true, p_admin: true, cutoff_time: null, p_submitted: `${today}T00:00:00+08:00`,
          });
          for (const name of ['quote', 'create_order']) await assert.rejects(api(name, payload, user), /not available for same-day/);
        }
        for (const name of ['quote', 'create_order']) await assert.rejects(api(name, checkout(same, yesterday), user), /Past fulfillment dates/);
      }
      assert.deepEqual(await snapshot(), before);
      assert.equal(await remaining(same, today), 5);
      assert.equal(await remaining(zero, today), 5);
      // A direct malformed legacy product cannot turn a production item into
      // same-day stock even if it bypassed the current owner save validation.
      await db.query("update tlb.products set data=data||'{\"allow_same_day\":true,\"lead_days\":1}'::jsonb where id=$1", [zero.id]);
      await assert.rejects(api('quote', checkout(zero, today)), /not available for same-day/);
    })();

    await check('public requests cannot spoof the clock or cutoff to order same-day after the configured cutoff', async () => {
      const today = await h.day(0);
      const { product } = await fixture(5, { lead_days: 0, allow_same_day: true });
      await inventory(product, today, 5);
      await settings({ cutoff_time: '00:00' });
      const before = await snapshot();
      const payload = checkout(product, today, { cutoff_time: null, p_submitted: `${today}T00:00:00Z`, admin: true, p_admin: true });
      for (const name of ['quote', 'create_order']) await assert.rejects(api(name, payload), /same-day order cutoff has passed/);
      assert.deepEqual(await snapshot(), before);
      await settings({ cutoff_time: null });
    })();

    await check('same-day stock still respects closures, shop pause, pickup-only products and minimum quantities', async () => {
      const today = await h.day(0);
      const { product } = await fixture(5, { lead_days: 0, allow_same_day: true, min_quantity: 2 });
      await inventory(product, today, 5);
      const pickup = checkout(product, today, { items: [item(product, 2)] });
      const delivery = { ...pickup, method: 'delivery', address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' } };
      await assert.rejects(api('quote', checkout(product, today)), /Minimum quantity/);
      for (const field of ['blocked_dates', 'pickup_blocked_dates', 'delivery_blocked_dates']) {
        await settings({ [field]: [today] });
        const blocked = field === 'delivery_blocked_dates' ? delivery : pickup;
        for (const name of ['quote', 'create_order']) await assert.rejects(api(name, blocked), /closed to new/);
        if (field !== 'blocked_dates') assert.ok(await api('quote', field === 'delivery_blocked_dates' ? pickup : delivery));
        await settings({ [field]: [] });
      }
      const dow = await h.scalar("select extract(dow from (clock_timestamp() at time zone 'Asia/Manila')::date)::int");
      await settings({ fulfillment_weekdays: baseSettings.fulfillment_weekdays.filter(n => n !== dow) });
      await assert.rejects(api('quote', pickup), /closed to new/);
      await settings({ fulfillment_weekdays: baseSettings.fulfillment_weekdays, paused: true });
      await assert.rejects(api('create_order', pickup), /paused|not accepting|closed|setup is in progress/i);
      await settings({ paused: false });
      await saveProduct({ ...product, pickup_only: true });
      await assert.rejects(api('quote', delivery), /pickup only/);
      assert.ok(await api('quote', pickup));
      await saveProduct({ ...product, active: false });
      await assert.rejects(api('quote', pickup), /Product unavailable/);
      await saveProduct(product);
      await inventory(product, today, 5, false);
      await assert.rejects(api('quote', pickup), /unavailable/);
      await inventory(product, today, 1);
      await assert.rejects(api('create_order', pickup), /Only 1 units/);
    })();

    await check('same-day orders reserve shared stock once and keep the 15-minute proof and manual approval rules', async () => {
      const today = await h.day(0);
      const { product } = await fixture(2, { lead_days: 0, allow_same_day: true });
      await inventory(product, today, 2);
      const payload = checkout(product, today);
      assert.equal((await api('quote', payload)).earliest_date, today);
      const saved = await api('create_order', payload);
      assert.equal(saved.fulfillment_date, today);
      assert.equal((Date.parse(saved.payment_deadline) - Date.parse(saved.created_at)) / 1000, 900);
      assert.equal(await remaining(product, today), 1);
      assert.equal((await api('create_order', payload)).id, saved.id);
      assert.equal(await h.scalar("select count(*)::int from tlb.outbox where order_id=$1 and event_type='order_submitted'", [saved.id]), 1);
      let reviewed = await proof(saved);
      await db.query("update tlb.orders set created_at=clock_timestamp()-interval '16 minutes',payment_deadline=clock_timestamp()-interval '1 minute' where id=$1", [saved.id]);
      await api('catalog');
      reviewed = await order(saved.id);
      assert.equal(reviewed.payment_status, 'under_review');
      assert.equal(await remaining(product, today), 1);
      assert.equal((await action('approve_payment', reviewed)).payment_status, 'paid');
      const second = await api('create_order', checkout(product, today, { method: 'delivery', address: { locality: 'QA City / QA Barangay', line1: '123 QA Street' } }));
      assert.equal(await remaining(product, today), 0);
      await assert.rejects(api('create_order', checkout(product, today)), /Only 0 units/);
      await db.query("update tlb.orders set payment_deadline=clock_timestamp()-interval '1 second' where id=$1", [second.id]);
      await api('catalog');
      assert.equal((await order(second.id)).fulfillment_status, 'expired');
      assert.equal(await remaining(product, today), 1);
    })();

    await check('disabling same-day later preserves existing bookings and paid staff amendments', async () => {
      const today = await h.day(0);
      const { product } = await fixture(3, { lead_days: 0, allow_same_day: true });
      await inventory(product, today, 3);
      const saved = await action('approve_payment', await proof(await api('create_order', checkout(product, today))));
      await saveProduct({ ...product, allow_same_day: false, lead_days: 2 });
      await settings({ blocked_dates: [today] });
      const unchanged = await order(saved.id);
      assert.equal(unchanged.payment_status, 'paid');
      assert.equal(unchanged.fulfillment_date, today);
      assert.equal(unchanged.paid_amount_cents, saved.paid_amount_cents);
      assert.equal(await remaining(product, today), 2);
      const edited = await action('edit_order', unchanged, { changes: { buyer: { name: 'Corrected customer' } }, reason: 'Correct customer name' });
      assert.equal(edited.payment_status, 'paid');
      assert.equal(edited.paid_amount_cents, saved.paid_amount_cents);
      await settings({ blocked_dates: [] });
      await assert.rejects(api('quote', checkout(product, today)), /not available for same-day/);
      const amended = await action('edit_order', edited, { changes: { items: [item(product, 2)] }, reason: 'Staff-arranged extra ready stock' });
      assert.equal(amended.payment_status, 'paid');
      assert.equal(amended.paid_amount_cents, saved.paid_amount_cents);
      assert.equal(amended.total_cents, 20000);
      assert.equal(await remaining(product, today), 1);
    })();

    await check('same-day migration upgrades CRLF definitions without changing existing data, grants, cutoff helpers or protected rules', async () => {
      const installed = await Promise.all(signatures.map(definition));
      const helperBefore = await definition('tlb.earliest_lead_date(timestamp with time zone,integer,jsonb)');
      const before = await snapshot();
      try {
        for (let i = 0; i < signatures.length; i++) await db.exec(beforeUpgrade(signatures[i], installed[i]).replace(/\r?\n/g, '\r\n'));
        await db.exec(migration);
        const updated = await Promise.all(signatures.map(definition));
        assert.ok(updated.every(source => source.includes('TLB_PRODUCT_SAME_DAY_V1') && source.includes('\r\n')));
        assert.ok(updated[0].includes('TLB_CUSTOMER_BOOKING_CALENDAR_V1'));
        assert.ok(updated[0].includes('TLB_DELIVERY_OPTIONS_V1'));
        assert.ok(updated[1].includes("submitted_at,submitted_at+interval '15 minutes'"));
        await db.exec(migration);
        assert.deepEqual(await Promise.all(signatures.map(definition)), updated);
        assert.deepEqual(await snapshot(), before);
        assert.equal(await definition('tlb.earliest_lead_date(timestamp with time zone,integer,jsonb)'), helperBefore);
        assert.equal(await h.scalar("select tlb.valid_contact_phone('Call Brent')"), false);
        for (const role of ['anon', 'authenticated']) {
          assert.equal(await h.scalar("select has_function_privilege($1,$2,'execute')", [role, signatures[0]]), false);
          assert.equal(await h.scalar("select has_function_privilege($1,$2,'execute')", [role, signatures[1]]), true);
        }
      } finally {
        for (const source of installed) await db.exec(source);
      }
    })();

    await check('same-day migration aborts both function updates atomically if an installed anchor has drifted', async () => {
      const installed = await Promise.all(signatures.map(definition));
      const before = await snapshot();
      try {
        await db.exec(beforeUpgrade(signatures[0], installed[0]));
        await db.exec(beforeUpgrade(signatures[1], installed[1]).replace("jsonb_build_object('pickup_only',false,'description',''", "jsonb_build_object('pickup_only',false, 'description',''"));
        const drifted = await Promise.all(signatures.map(definition));
        await assert.rejects(db.exec(migration), /Unexpected function definition.*same-day migration/);
        assert.deepEqual(await Promise.all(signatures.map(definition)), drifted);
        assert.deepEqual(await snapshot(), before);
      } finally {
        for (const source of installed) await db.exec(source);
      }
    })();
  } finally {
    await settings(oldSettings);
  }
}

