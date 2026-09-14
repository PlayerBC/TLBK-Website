import { randomUUID } from 'node:crypto';

export async function makeHarness(db) {
  const ids = { owner: randomUUID(), staff: randomUUID(), customer: randomUUID(), stranger: randomUUID(), unverified: randomUUID() };
  for (const [name, id] of Object.entries(ids)) {
    await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [
      id, `${name}@example.test`, name === 'unverified' ? null : new Date().toISOString(),
    ]);
  }
  await db.query("insert into tlb.staff (user_id, role) values ($1, 'owner'), ($2, 'staff')", [ids.owner, ids.staff]);

  async function as(user, callback, role = user ? 'authenticated' : 'anon') {
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false), set_config('request.jwt.claims', $3, false)", [
      user || '', role, JSON.stringify({ sub: user, role }),
    ]);
    await db.exec(`set role ${role}`);
    try { return await callback(); }
    finally {
      await db.exec('reset role');
      await db.exec("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claims', '{}', false)");
    }
  }
  const api = (action, payload = {}, user = null, token = null) => as(user, async () => (
    await db.query('select public.shop_api($1, $2::jsonb, $3) as result', [action, JSON.stringify(payload), token])
  ).rows[0].result);
  const service = (action, payload = {}) => as(null, async () => (
    await db.query('select public.shop_service($1, $2::jsonb) as result', [action, JSON.stringify(payload)])
  ).rows[0].result, 'service_role');
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const day = async (offset = 30) => scalar("select ((clock_timestamp() at time zone 'Asia/Manila')::date + $1::int)::text", [offset]);
  const item = (product, quantity = 1, selections = {}) => ({ product_id: product.id, quantity, selections });
  const checkout = (product, date, changes = {}) => ({
    items: [item(product)], fulfillment_date: date, method: 'pickup',
    buyer: { name: 'QA Customer', email: 'customer@example.test', phone: '09171234567' },
    recipient: { name: 'QA Recipient', phone: '09177654321' },
    instructions: 'Test fixture only', idempotency_key: randomUUID(), ...changes,
  });
  const product = async (overrides = {}) => api('save_product', { product: {
    name: `QA ${randomUUID().slice(0, 8)}`, description: 'Local test fixture only', category_id: null,
    price_cents: 10000, min_quantity: 1, lead_days: 1, active: true,
    photos: [], option_groups: [], sort_order: 0, ...overrides,
  } }, ids.owner);
  const inventory = async (product, date, capacity, available = true) => api('save_inventory', {
    rows: [{ product_id: product.id, date, capacity, available }],
  }, ids.owner);
  const fixture = async (capacity = 10, overrides = {}) => {
    const p = await product(overrides);
    const date = await day();
    await inventory(p, date, capacity);
    return { product: p, date };
  };
  const order = (id) => api('get_order', { order_id: id }, ids.owner);
  const action = (name, o, extras = {}) => api(name, {
    order_id: o.id, revision: o.revision, idempotency_key: randomUUID(), ...extras,
  }, ids.owner);
  const proof = (o, extras = {}) => service('commit_proof', {
    order_id: o.id, token: o.access_token, user_id: null,
    path: `${o.id}/${randomUUID()}.png`, payment_reference: 'QA-PAYMENT-123', ...extras,
  });
  const remaining = (product, date) => scalar('select tlb.capacity_remaining($1::uuid, $2::date)', [product.id, date]);
  const allocations = (id) => db.query('select product_id::text, date::text, quantity, state from tlb.allocations where order_id=$1 order by product_id,date', [id]).then(r => r.rows);

  return { ids, as, api, service, scalar, day, item, checkout, product, inventory, fixture, order, action, proof, remaining, allocations };
}
