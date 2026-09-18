import assert from 'node:assert/strict';
import {leadTimeCases} from '../lead-time-cases.mjs';
import {earliestLeadDate} from '../../assets/ordering/shop-rules.js';

export default async function ({ db, check }) {
  const settings = {
    production_weekdays: [0, 1, 2, 3, 4, 5, 6],
    nonproduction_dates: [],
    fulfillment_weekdays: [0, 1, 2, 3, 4, 5, 6],
    blocked_dates: [],
    cutoff_time: null,
  };
  const earliest = async (submitted, days, overrides = {}) => {
    const result = await db.query(
      'select tlb.earliest_lead_date($1::timestamptz, $2::integer, $3::jsonb)::text as date',
      [submitted, days, JSON.stringify({ ...settings, ...overrides })],
    );
    return result.rows[0].date;
  };

  await check('one production day counts strictly between Monday submission and Wednesday fulfillment', async () => {
    assert.equal(await earliest('2026-09-14T09:00:00+08:00', 1), '2026-09-16');
  })();
  await check('zero lead days still starts with the following Manila date', async () => {
    assert.equal(await earliest('2026-09-14T23:59:59+08:00', 0), '2026-09-15');
  })();
  await check('weekends and explicitly excluded production dates do not count', async () => {
    assert.equal(await earliest('2026-09-18T09:00:00+08:00', 1, {
      production_weekdays: [1, 2, 3, 4, 5],
      nonproduction_dates: ['2026-09-21'],
    }), '2026-09-23');
  })();
  await check('cutoff counts today only before the boundary and disabled cutoff starts tomorrow', async () => {
    assert.equal(await earliest('2026-09-14T13:59:59+08:00', 1, { cutoff_time: '14:00' }), '2026-09-15');
    assert.equal(await earliest('2026-09-14T14:00:00+08:00', 1, { cutoff_time: '14:00' }), '2026-09-16');
    assert.equal(await earliest('2026-09-14T22:00:00+08:00', 1), '2026-09-16');
  })();
  for (const scenario of leadTimeCases) await check(`browser/server lead-time parity: ${scenario.name}`, async () => {
    const config = { ...settings, cutoff_time: '12:00', ...scenario.settings };
    assert.equal(await earliest(scenario.at, scenario.days, config), scenario.expected);
    assert.equal(earliestLeadDate({ lead_days: scenario.days }, config, new Date(scenario.at)), scenario.expected);
  })();
  await check('lead time uses the Manila date rather than the UTC date', async () => {
    assert.equal(await earliest('2026-09-14T16:30:00Z', 1), '2026-09-17');
  })();
  await check('an impossible production schedule fails without an infinite loop', async () => {
    await assert.rejects(earliest('2026-09-14T09:00:00+08:00', 1, {
      production_weekdays: [],
    }), /production schedule/i);
  })();
  await check('fulfillment constraints are separate from production-day counting', async () => {
    const result = await db.query(`
      select
        tlb.date_supported('2026-09-16', 'pickup', $1::jsonb) as pickup,
        tlb.date_supported('2026-09-16', 'delivery', $1::jsonb) as delivery,
        tlb.date_supported('2026-09-17', 'pickup', $1::jsonb) as blocked
    `, [JSON.stringify({ ...settings, pickup_blocked_dates: ['2026-09-16'], blocked_dates: ['2026-09-17'] })]);
    assert.deepEqual(result.rows[0], { pickup: false, delivery: true, blocked: false });
  })();
}
