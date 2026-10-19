import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import type { Coupon } from '../src/domain/types.js';
import { InMemoryStore } from '../src/store/memory.js';

let server: Server;
let store: InMemoryStore;
let baseUrl: string;

beforeEach(async () => {
  store = new InMemoryStore(undefined, { couponInterval: 2, discountPercent: 10 });
  server = createServer(createApp(store));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function post(path: string, body: unknown, key: string = randomUUID()): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(path.endsWith('/checkout') ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readyCart(productId = 'product-1'): Promise<string> {
  const created = await post('/carts', {});
  expect(created.status).toBe(201);
  const cart = await created.json();
  const added = await post(`/carts/${cart.id}/items`, { productId, quantity: 1 });
  expect(added.status).toBe(200);
  return cart.id;
}

async function earnCoupon(): Promise<Coupon> {
  for (let i = 0; i < 2; i++) {
    const id = await readyCart();
    expect((await post(`/carts/${id}/checkout`, {})).status).toBe(201);
  }
  const generated = await post('/admin/coupons', {});
  expect(generated.status).toBe(201);
  return generated.json();
}

test('administrative generation requires an eligible milestone and returns the configured coupon', async () => {
  const early = await post('/admin/coupons', {});
  expect(early.status).toBe(409);
  expect(await early.json()).toMatchObject({ error: { code: 'NO_ELIGIBLE_MILESTONE' } });
  const coupon = await earnCoupon();
  expect(coupon).toMatchObject({ milestone: 2, discountPercent: 10, status: 'available', redeemedOrderId: null });
  const repeated = await post('/admin/coupons', {});
  expect(repeated.status).toBe(409);
  expect(await repeated.json()).toMatchObject({ error: { code: 'NO_ELIGIBLE_MILESTONE' } });
  const overridden = await post('/admin/coupons', { discountPercent: 100 });
  expect(overridden.status).toBe(400);
  expect(await overridden.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(store.state.coupons.size).toBe(1);
});

test('coupon checkout returns the calculation snapshot and matching retries replay the same order', async () => {
  const coupon = await earnCoupon();
  const cartId = await readyCart();
  const responses = await Promise.all(Array.from({ length: 8 }, () => (
    post(`/carts/${cartId}/checkout`, { couponCode: coupon.code }, 'same-coupon-key')
  )));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  for (const [index, response] of responses.entries()) {
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(`/orders/${bodies[0].id}`);
    expect(bodies[index]).toEqual(bodies[0]);
  }
  expect(bodies[0]).toMatchObject({
    subtotalPaise: 12500, discountPaise: 1250, totalPaise: 11250,
    coupon: { code: coupon.code, milestone: 2, discountPercent: 10 },
  });
  const receipt = await fetch(`${baseUrl}/orders/${bodies[0].id}`);
  expect(receipt.status).toBe(200);
  expect(await receipt.json()).toEqual(bodies[0]);
  expect(store.state.orders.size).toBe(3);
  expect(store.state.products.get('product-1')!.availableInventory).toBe(47);
  expect(store.state.coupons.get(coupon.code)).toMatchObject({
    status: 'redeemed', redeemedOrderId: bodies[0].id,
  });
  for (const body of [{}, { couponCode: 'different-code' }]) {
    const changed = await post(`/carts/${cartId}/checkout`, body, 'same-coupon-key');
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  }
});

test('competing HTTP checkouts cannot redeem the same coupon twice', async () => {
  const coupon = await earnCoupon();
  const first = await readyCart('product-2');
  const second = await readyCart('product-2');
  const responses = await Promise.all([
    post(`/carts/${first}/checkout`, { couponCode: coupon.code }, 'first-redemption'),
    post(`/carts/${second}/checkout`, { couponCode: coupon.code }, 'second-redemption'),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  expect(await responses.find((response) => response.status === 409)!.json())
    .toMatchObject({ error: { code: 'COUPON_ALREADY_REDEEMED' } });
  const winner = await responses.find((response) => response.status === 201)!.json();
  expect(store.state.coupons.get(coupon.code)!.redeemedOrderId).toBe(winner.id);
  expect(store.state.products.get('product-2')!.availableInventory).toBe(99);
  expect(store.state.orders.size).toBe(3);
  expect(store.state.checkoutKeys.size).toBe(3);
});

test('failed checkout preserves an available coupon and a corrected retry may redeem it', async () => {
  const coupon = await earnCoupon();
  const cartId = await readyCart();
  const products = new Map(store.state.products);
  const original = products.get('product-1')!;
  products.set(original.id, { ...original, availableInventory: 0 });
  store.state = { ...store.state, products };
  const before = structuredClone(store.state);
  const failed = await post(`/carts/${cartId}/checkout`, { couponCode: coupon.code }, 'repair-key');
  expect(failed.status).toBe(409);
  expect(await failed.json()).toMatchObject({ error: { code: 'INSUFFICIENT_STOCK' } });
  expect(store.state).toEqual(before);
  expect(store.state.coupons.get(coupon.code)!.status).toBe('available');
  const repaired = new Map(store.state.products);
  repaired.set(original.id, original);
  store.state = { ...store.state, products: repaired };
  const retry = await post(`/carts/${cartId}/checkout`, { couponCode: coupon.code }, 'repair-key');
  expect(retry.status).toBe(201);
  expect((await retry.json()).discountPaise).toBe(1250);
  expect(store.state.coupons.get(coupon.code)!.status).toBe('redeemed');
});

test('invalid coupon shapes and unknown codes return distinguishable errors without state changes', async () => {
  const coupon = await earnCoupon();
  const cartId = await readyCart();
  const before = structuredClone(store.state);
  for (const body of [{ couponCode: null }, { couponCode: [] }, { couponCodes: [coupon.code] }]) {
    const response = await post(`/carts/${cartId}/checkout`, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  }
  const missing = await post(`/carts/${cartId}/checkout`, { couponCode: 'missing' });
  expect(missing.status).toBe(409);
  expect(await missing.json()).toMatchObject({ error: { code: 'INVALID_COUPON' } });
  expect(store.state).toEqual(before);
});

test('concurrent administrative requests cannot generate one milestone twice', async () => {
  for (let i = 0; i < 2; i++) {
    const id = await readyCart();
    await post(`/carts/${id}/checkout`, {});
  }
  const responses = await Promise.all(Array.from({ length: 8 }, () => post('/admin/coupons', {})));
  expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
  for (const response of responses.filter((response) => response.status === 409)) {
    expect(await response.json()).toMatchObject({ error: { code: 'NO_ELIGIBLE_MILESTONE' } });
  }
  expect(store.state.coupons.size).toBe(1);
  expect([...store.state.coupons.values()][0].milestone).toBe(2);
});
