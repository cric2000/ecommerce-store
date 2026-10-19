import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store/memory.js';

let server: Server;
let store: InMemoryStore;
let baseUrl: string;

beforeEach(async () => {
  store = new InMemoryStore();
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

async function createCart(productId?: string): Promise<string> {
  const created = await post('/carts', {});
  expect(created.status).toBe(201);
  const cart = await created.json();
  if (productId) {
    const added = await post(`/carts/${cart.id}/items`, { productId, quantity: 1 });
    expect(added.status).toBe(200);
  }
  return cart.id;
}

test('checkout returns 201/Location, retrieval preserves the order, and inventory/cart reflect the purchase', async () => {
  const cartId = await createCart('product-5');
  const checkedOut = await post(`/carts/${cartId}/checkout`, {});
  expect(checkedOut.status).toBe(201);
  const order = await checkedOut.json();
  expect(checkedOut.headers.get('location')).toBe(`/orders/${order.id}`);
  expect(order).toMatchObject({
    cartId, status: 'placed', currency: 'INR', subtotalPaise: 74900,
    coupon: null, discountPaise: 0, totalPaise: 74900,
    items: [{ productId: 'product-5', name: 'Desk lamp', quantity: 1, unitPricePaise: 74900, lineTotalPaise: 74900 }],
  });
  const read = await fetch(`${baseUrl}/orders/${order.id}`);
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(order);
  const cart = await (await fetch(`${baseUrl}/carts/${cartId}`)).json();
  expect(cart).toMatchObject({ status: 'checked_out', orderId: order.id });
  expect(cart.items[0]).toMatchObject({ availableInventory: 0, isAvailable: false });

  const repeat = await post(`/carts/${cartId}/checkout`, {});
  expect(repeat.status).toBe(409);
  expect(await repeat.json()).toMatchObject({ error: { code: 'CART_ALREADY_CHECKED_OUT' } });
  expect(store.state.orders.size).toBe(1);
  expect(store.state.products.get('product-5')!.availableInventory).toBe(0);
});

test('empty carts and missing cart/order IDs return distinct errors', async () => {
  const cartId = await createCart();
  const empty = await post(`/carts/${cartId}/checkout`, {});
  expect(empty.status).toBe(409);
  expect(await empty.json()).toMatchObject({ error: { code: 'EMPTY_CART' } });
  const missingCart = await post('/carts/missing/checkout', {});
  expect(missingCart.status).toBe(404);
  expect(await missingCart.json()).toMatchObject({ error: { code: 'CART_NOT_FOUND' } });
  const missingOrder = await fetch(`${baseUrl}/orders/missing`);
  expect(missingOrder.status).toBe(404);
  expect(await missingOrder.json()).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
  expect(store.state.orders.size).toBe(0);
});

test('a cart added before another purchase rechecks stock and fails without partial changes', async () => {
  const first = await createCart('product-5');
  const second = await createCart('product-5');
  expect((await post(`/carts/${first}/checkout`, {})).status).toBe(201);
  const before = structuredClone(store.state);
  const rejected = await post(`/carts/${second}/checkout`, {});
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({
    error: {
      code: 'INSUFFICIENT_STOCK',
      details: { productId: 'product-5', requestedQuantity: 1, availableInventory: 0 },
    },
  });
  expect(store.state).toEqual(before);
  expect(store.state.carts.get(second)!.status).toBe('active');
});

test('unsupported coupon fields and malformed/missing bodies do not close a valid cart', async () => {
  const cartId = await createCart('product-1');
  const before = structuredClone(store.state);
  for (const body of [{ couponCode: 'later' }, { totalPaise: 0 }, null, []]) {
    const response = await post(`/carts/${cartId}/checkout`, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  }
  const malformed = await fetch(`${baseUrl}/carts/${cartId}/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });
  const missing = await fetch(`${baseUrl}/carts/${cartId}/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(store.state).toEqual(before);
});

test('a current price that overflows the subtotal returns 422 without consuming inventory', async () => {
  const cartId = await createCart('product-1');
  await post(`/carts/${cartId}/items`, { productId: 'product-2', quantity: 1 });
  const products = new Map(store.state.products);
  products.set('product-1', { ...products.get('product-1')!, unitPricePaise: Number.MAX_SAFE_INTEGER });
  store.state = { ...store.state, products };
  const before = structuredClone(store.state);
  const response = await post(`/carts/${cartId}/checkout`, {});
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: 'AMOUNT_OUT_OF_RANGE' } });
  expect(store.state).toEqual(before);
});

test('competing HTTP checkouts for the last item cannot oversell', async () => {
  const first = await createCart('product-5');
  const second = await createCart('product-5');
  const responses = await Promise.all([
    post(`/carts/${first}/checkout`, {}, 'first-http-key'),
    post(`/carts/${second}/checkout`, {}, 'second-http-key'),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  const failed = responses.find((response) => response.status === 409)!;
  expect(await failed.json()).toMatchObject({ error: { code: 'INSUFFICIENT_STOCK' } });
  expect(store.state.orders.size).toBe(1);
  expect(store.state.checkoutKeys.size).toBe(1);
  expect(store.state.products.get('product-5')!.availableInventory).toBe(0);
});

test('concurrent HTTP retries return the original 201, body, and Location with one deduction', async () => {
  const cartId = await createCart('product-5');
  const responses = await Promise.all(Array.from({ length: 12 }, () => (
    post(`/carts/${cartId}/checkout`, {}, 'repeat-http-key')
  )));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  for (const [index, response] of responses.entries()) {
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(`/orders/${bodies[0].id}`);
    expect(bodies[index]).toEqual(bodies[0]);
  }
  const formattedReplay = await fetch(`${baseUrl}/carts/${cartId}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'repeat-http-key' },
    body: '{ \n }',
  });
  expect(formattedReplay.status).toBe(201);
  expect(await formattedReplay.json()).toEqual(bodies[0]);
  expect(store.state.orders.size).toBe(1);
  expect(store.state.checkoutKeys.size).toBe(1);
  expect(store.state.products.get('product-5')!.availableInventory).toBe(0);
});

test('concurrent HTTP requests cannot reuse a successful key for another cart', async () => {
  const first = await createCart('product-1');
  const second = await createCart('product-1');
  const responses = await Promise.all([
    post(`/carts/${first}/checkout`, {}, 'global-key'),
    post(`/carts/${second}/checkout`, {}, 'global-key'),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  expect(await responses.find((response) => response.status === 409)!.json())
    .toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  expect(store.state.orders.size).toBe(1);
  expect(store.state.products.get('product-1')!.availableInventory).toBe(49);
});

test('missing or malformed key headers return 400 and leave a valid cart unchanged', async () => {
  const cartId = await createCart('product-1');
  const before = structuredClone(store.state);
  for (const key of [undefined, '', 'bad key', 'x'.repeat(129)]) {
    const response = await fetch(`${baseUrl}/carts/${cartId}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key === undefined ? {} : { 'Idempotency-Key': key }),
      },
      body: '{}',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } });
  }
  expect(store.state).toEqual(before);
});

test('duplicate key headers are rejected even when both values are identical', async () => {
  const cartId = await createCart('product-1');
  const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const request = httpRequest(`${baseUrl}/carts/${cartId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ['same-key', 'same-key'] },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.end('{}');
  });
  expect(result.status).toBe(400);
  expect(JSON.parse(result.body)).toMatchObject({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } });
  expect(store.state.orders.size).toBe(0);
  expect(store.state.checkoutKeys.size).toBe(0);
});
