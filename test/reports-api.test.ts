import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import type { CartItem, Order } from '../src/domain/types.js';
import { InMemoryStore } from '../src/store/memory.js';

let server: Server;
let store: InMemoryStore;
let baseUrl: string;

beforeEach(async () => {
  store = new InMemoryStore(undefined, { couponInterval: 1, discountPercent: 10 });
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

async function purchase(items: readonly CartItem[], couponCode?: string): Promise<Order> {
  const created = await post('/carts', {});
  expect(created.status).toBe(201);
  const cart = await created.json();
  for (const item of items) expect((await post(`/carts/${cart.id}/items`, item)).status).toBe(200);
  const response = await post(`/carts/${cart.id}/checkout`, couponCode === undefined ? {} : { couponCode });
  expect(response.status).toBe(201);
  return response.json();
}

test('GET /admin/report returns the empty schema with HTTP 200 and no authentication', async () => {
  const response = await fetch(`${baseUrl}/admin/report`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({
    currency: 'INR', purchasedQuantityByProduct: [], grossRevenuePaise: 0,
    totalDiscountsPaise: 0, netRevenuePaise: 0,
    coupons: { generated: 0, available: 0, redeemed: 0 }, totalOrders: 0,
  });
});

test('HTTP report reconciles with retrieved order receipts and generated coupon records', async () => {
  const first = await purchase([{ productId: 'product-2', quantity: 2 }]);
  const second = await purchase([{ productId: 'product-1', quantity: 1 }]);
  const generated = await post('/admin/coupons', {});
  expect(generated.status).toBe(201);
  const coupon = await generated.json();
  const next = await post('/admin/coupons', {});
  expect(next.status).toBe(201);
  const unused = await next.json();
  const third = await purchase([
    { productId: 'product-2', quantity: 3 }, { productId: 'product-1', quantity: 2 },
  ], coupon.code);
  const response = await fetch(`${baseUrl}/admin/report`);
  expect(response.status).toBe(200);
  const report = await response.json();
  expect(report).toEqual({
    currency: 'INR',
    purchasedQuantityByProduct: [
      { productId: 'product-1', quantity: 3 }, { productId: 'product-2', quantity: 5 },
    ],
    grossRevenuePaise: 50000, totalDiscountsPaise: 3250, netRevenuePaise: 46750,
    coupons: { generated: 2, available: 1, redeemed: 1 }, totalOrders: 3,
  });
  const receipts: Order[] = [];
  for (const order of [first, second, third]) {
    const receipt = await fetch(`${baseUrl}/orders/${order.id}`);
    expect(receipt.status).toBe(200);
    receipts.push(await receipt.json());
  }
  expect(report.grossRevenuePaise).toBe(receipts.reduce((sum, order) => sum + order.subtotalPaise, 0));
  expect(report.totalDiscountsPaise).toBe(receipts.reduce((sum, order) => sum + order.discountPaise, 0));
  expect(report.netRevenuePaise).toBe(receipts.reduce((sum, order) => sum + order.totalPaise, 0));
  expect(store.state.coupons.get(coupon.code)!.redeemedOrderId).toBe(third.id);
  expect(store.state.coupons.get(unused.code)!.status).toBe('available');
});

test('repeated HTTP reports leave all state unchanged and do not generate an eligible coupon', async () => {
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  const state = store.state;
  const before = structuredClone(state);
  const expected = await (await fetch(`${baseUrl}/admin/report`)).json();
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`${baseUrl}/admin/report`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
  }
  expect(expected.coupons).toEqual({ generated: 0, available: 0, redeemed: 0 });
  expect(store.state).toBe(state);
  expect(store.state).toEqual(before);
  const coupon = await post('/admin/coupons', {});
  expect(coupon.status).toBe(201);
  expect((await coupon.json()).milestone).toBe(1);
});

test('unsafe report totals return a structured 422 error without changing state', async () => {
  const products = new Map(store.state.products);
  products.set('product-1', { ...products.get('product-1')!, unitPricePaise: Number.MAX_SAFE_INTEGER });
  store.state = { ...store.state, products };
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  const before = structuredClone(store.state);
  const response = await fetch(`${baseUrl}/admin/report`);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: 'AMOUNT_OUT_OF_RANGE' } });
  expect(store.state).toEqual(before);
});
