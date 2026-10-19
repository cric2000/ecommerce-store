import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store/memory.js';
import { PostgresStoreAccess } from '../src/store/postgres.js';
import { CartService } from '../src/services/carts.js';
import { CouponService } from '../src/services/coupons.js';
import { OrderService } from '../src/services/orders.js';
import { ReportService } from '../src/services/reports.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('shared PostgreSQL store', () => {
  let admin: Pool;
  let namespace: string;
  let adapters: PostgresStoreAccess[];
  let namespaces: Set<string>;
  let servers: Server[];

  beforeAll(() => { admin = new Pool({ connectionString: databaseUrl }); });
  beforeEach(() => {
    namespace = `test-${randomUUID()}`;
    adapters = [];
    namespaces = new Set();
    servers = [];
  });
  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
    await Promise.all(adapters.map((adapter) => adapter.close()));
    await admin.query('DELETE FROM ecommerce_state WHERE namespace = ANY($1::text[])', [[...namespaces]]);
  });
  afterAll(async () => { await admin.end(); });

  function access(name = namespace, interval = 1) {
    const adapter = new PostgresStoreAccess(databaseUrl!, new InMemoryStore(undefined, {
      couponInterval: interval, discountPercent: 10,
    }), name);
    namespaces.add(name);
    adapters.push(adapter);
    return adapter;
  }
  const report = (adapter: PostgresStoreAccess) => adapter.read((store) => new ReportService(store).getReport());
  const checkout = (adapter: PostgresStoreAccess, id: string, key: string, couponCode?: string) => adapter.write(
    (store) => new OrderService(store).checkout(id, couponCode ? { couponCode } : {}, key),
  );
  async function cart(adapter: PostgresStoreAccess, productId = 'product-1') {
    const created = await adapter.write((store) => new CartService(store).createCart({}));
    await adapter.write((store) => new CartService(store).addItem(created.id, { productId, quantity: 1 }));
    return created;
  }
  async function serve(adapter: PostgresStoreAccess) {
    const server = createServer(createApp(adapter));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  test('concurrent cold starts seed once; a new instance retains purchases and the original reward configuration', async () => {
    const first = access();
    const second = access();
    const reports = await Promise.all([report(first), report(second)]);
    expect(reports[0]).toEqual(reports[1]);
    expect(reports[0].totalOrders).toBe(0);
    const ready = await cart(first, 'product-5');
    const order = await checkout(second, ready.id, 'persisted');
    const restarted = access(namespace, 99);
    expect(await restarted.read((store) => new OrderService(store).getOrder(order.id))).toEqual(order);
    expect(await restarted.read((store) => store.state.products.get('product-5')!.availableInventory)).toBe(0);
    expect(await restarted.read((store) => store.rewards.couponInterval)).toBe(1);
    expect((await report(restarted)).totalOrders).toBe(1);
  });

  test('two independent instances cannot both purchase the last item', async () => {
    const first = access();
    const second = access();
    const [left, right] = await Promise.all([cart(first, 'product-5'), cart(second, 'product-5')]);
    const results = await Promise.allSettled([
      checkout(first, left.id, 'left'), checkout(second, right.id, 'right'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected'))
      .toMatchObject({ reason: { code: 'INSUFFICIENT_STOCK' } });
    expect((await report(second)).totalOrders).toBe(1);
    expect(await first.read((store) => store.state.products.get('product-5')!.availableInventory)).toBe(0);
  });

  test('matching concurrent retries across instances return one order and conflicting key reuse is rejected', async () => {
    const first = access();
    const second = access();
    const ready = await cart(first);
    const orders = await Promise.all(Array.from({ length: 8 }, (_, index) => (
      checkout(index % 2 ? first : second, ready.id, 'shared-key')
    )));
    for (const order of orders) expect(order).toEqual(orders[0]);
    const another = await cart(second);
    await expect(checkout(first, another.id, 'shared-key')).rejects.toThrow(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    );
    expect((await report(first)).totalOrders).toBe(1);
    expect(await second.read((store) => store.state.products.get('product-1')!.availableInventory)).toBe(49);
  });

  test('different keys on the same cart commit once and bind only the successful key', async () => {
    const first = access();
    const second = access();
    const ready = await cart(first);
    const results = await Promise.allSettled([
      checkout(first, ready.id, 'key-a'), checkout(second, ready.id, 'key-b'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected'))
      .toMatchObject({ reason: { code: 'CART_ALREADY_CHECKED_OUT' } });
    expect(await second.read((store) => store.state.checkoutKeys.size)).toBe(1);
  });

  test('competing milestone generation and coupon redemption remain unique across instances', async () => {
    const first = access();
    const second = access();
    for (let i = 0; i < 2; i++) await checkout(first, (await cart(first)).id, `earn-${i}`);
    const generate = (adapter: PostgresStoreAccess) => adapter.write((store) => new CouponService(store).generate({}));
    const generated = await Promise.allSettled([generate(first), generate(second), generate(first)]);
    const coupons = generated.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    expect(coupons.map((coupon) => coupon.milestone).sort()).toEqual([1, 2]);
    expect(generated.find((result) => result.status === 'rejected'))
      .toMatchObject({ reason: { code: 'NO_ELIGIBLE_MILESTONE' } });
    const [left, right] = await Promise.all([cart(first), cart(second)]);
    const redeemed = await Promise.allSettled([
      checkout(first, left.id, 'redeem-a', coupons[0].code), checkout(second, right.id, 'redeem-b', coupons[0].code),
    ]);
    expect(redeemed.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(redeemed.find((result) => result.status === 'rejected'))
      .toMatchObject({ reason: { code: 'COUPON_ALREADY_REDEEMED' } });
    expect(await report(second)).toMatchObject({ totalOrders: 3, coupons: { generated: 2, available: 1, redeemed: 1 } });
  });

  test('a failed operation rolls back prepared stock, cart, order, key, and coupon changes', async () => {
    const first = access();
    const second = access();
    await checkout(first, (await cart(first)).id, 'earn');
    const coupon = await first.write((store) => new CouponService(store).generate({}));
    const ready = await cart(second);
    const before = await first.read((store) => structuredClone(store.state));
    await expect(first.write(async (store) => {
      await new OrderService(store).checkout(ready.id, { couponCode: coupon.code }, 'retry');
      throw new Error('failure after preparation');
    })).rejects.toThrow('failure after preparation');
    expect(await second.read((store) => store.state)).toEqual(before);
    const order = await checkout(second, ready.id, 'retry', coupon.code);
    expect(order.discountPaise).toBe(1250);
  });

  test('HTTP success waits for database commit; a rejected write returns 500 and leaves its key reusable', async () => {
    const first = access();
    const ready = await cart(first);
    const base = await serve(first);
    const constraint = `reject_orders_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`ALTER TABLE ecommerce_state ADD CONSTRAINT ${constraint}
      CHECK (namespace <> '${namespace}' OR jsonb_array_length(snapshot->'orders') = 0)`);
    const post = () => fetch(`${base}/carts/${ready.id}/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'commit-retry' }, body: '{}',
    });
    try {
      const response = await post();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
      expect(await report(first)).toMatchObject({ totalOrders: 0, grossRevenuePaise: 0 });
      expect(await first.read((store) => store.state.checkoutKeys.size)).toBe(0);
    } finally {
      await admin.query(`ALTER TABLE ecommerce_state DROP CONSTRAINT ${constraint}`);
    }
    expect((await post()).status).toBe(201);
  });

  test('two HTTP apps share carts/orders and report reads or checkout replay do not rewrite saved state', async () => {
    const first = access();
    const second = access();
    const [left, right] = await Promise.all([serve(first), serve(second)]);
    const post = (base: string, path: string, body: unknown) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-key' }, body: JSON.stringify(body),
    });
    const created = await post(left, '/carts', {});
    const ready = await created.json();
    expect((await post(right, `/carts/${ready.id}/items`, { productId: 'product-1', quantity: 1 })).status).toBe(200);
    const response = await post(left, `/carts/${ready.id}/checkout`, {});
    expect(response.status).toBe(201);
    const order = await response.json();
    const saved = async () => (await admin.query('SELECT xmin::text, snapshot FROM ecommerce_state WHERE namespace = $1', [namespace])).rows[0];
    const before = await saved();
    expect(await (await fetch(`${right}/orders/${order.id}`)).json()).toEqual(order);
    expect(await (await post(right, `/carts/${ready.id}/checkout`, {})).json()).toEqual(order);
    expect(await (await fetch(`${right}/admin/report`)).json()).toMatchObject({ totalOrders: 1, netRevenuePaise: 12500 });
    expect(await saved()).toEqual(before);
  });

  test('different namespaces isolate stores without overwriting an existing seed', async () => {
    const first = access();
    const isolated = access(`${namespace}-other`);
    await checkout(first, (await cart(first)).id, 'purchase');
    expect((await report(isolated)).totalOrders).toBe(0);
    expect((await report(first)).totalOrders).toBe(1);
  });
});
