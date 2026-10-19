import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { CartService } from '../src/services/carts.js';

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  server = createServer(createApp());
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

function jsonRequest(method: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createCart(): Promise<string> {
  const response = await jsonRequest('POST', '/carts', {});
  expect(response.status).toBe(201);
  const cart = await response.json();
  expect(response.headers.get('location')).toBe(`/carts/${cart.id}`);
  expect(cart).toMatchObject({ status: 'active', orderId: null, items: [], subtotalPaise: 0 });
  return cart.id;
}

test('catalog and the full cart lifecycle work through HTTP with documented response shapes', async () => {
  const products = await fetch(`${baseUrl}/products`);
  expect(products.status).toBe(200);
  const catalog = await products.json();
  expect(catalog.currency).toBe('INR');
  expect(catalog.products).toHaveLength(5);
  expect(catalog.products[4]).toMatchObject({ id: 'product-5', availableInventory: 1 });

  const cartId = await createCart();
  const path = `/carts/${cartId}`;
  const added = await jsonRequest('POST', `${path}/items`, { productId: 'product-1', quantity: 2 });
  expect(added.status).toBe(200);
  expect(await added.json()).toMatchObject({ subtotalPaise: 25000 });
  const updated = await jsonRequest('PATCH', `${path}/items/product-1`, { quantity: 3 });
  expect(updated.status).toBe(200);
  const expected = await updated.json();
  expect(expected.subtotalPaise).toBe(37500);
  const read = await fetch(`${baseUrl}${path}`);
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(expected);
  const removed = await fetch(`${baseUrl}${path}/items/product-1`, { method: 'DELETE' });
  expect(removed.status).toBe(200);
  expect(await removed.json()).toMatchObject({ items: [], subtotalPaise: 0 });
});

test('invalid products, quantities, and unknown properties produce distinct errors and preserve the cart', async () => {
  const cartId = await createCart();
  const cases = [
    { body: { productId: 'missing', quantity: 1 }, status: 404, code: 'PRODUCT_NOT_FOUND' },
    { body: { productId: 'product-1', quantity: 0 }, status: 400, code: 'INVALID_QUANTITY' },
    { body: { productId: 'product-1', quantity: '2' }, status: 400, code: 'INVALID_QUANTITY' },
    { body: { productId: 'product-1', quantity: 1.5 }, status: 400, code: 'INVALID_QUANTITY' },
    { body: { productId: 'product-1', quantity: 1, price: 0 }, status: 400, code: 'INVALID_REQUEST' },
  ];
  for (const item of cases) {
    const response = await jsonRequest('POST', `/carts/${cartId}/items`, item.body);
    expect(response.status).toBe(item.status);
    expect(await response.json()).toMatchObject({ error: { code: item.code } });
  }
  expect(await (await fetch(`${baseUrl}/carts/${cartId}`)).json())
    .toMatchObject({ items: [], subtotalPaise: 0 });
});

test('insufficient stock includes useful details and leaves the previous quantity intact', async () => {
  const cartId = await createCart();
  await jsonRequest('POST', `/carts/${cartId}/items`, { productId: 'product-5', quantity: 1 });
  const failed = await jsonRequest('PATCH', `/carts/${cartId}/items/product-5`, { quantity: 2 });
  expect(failed.status).toBe(409);
  expect(await failed.json()).toMatchObject({
    error: {
      code: 'INSUFFICIENT_STOCK',
      details: { productId: 'product-5', requestedQuantity: 2, availableInventory: 1 },
    },
  });
  const cart = await (await fetch(`${baseUrl}/carts/${cartId}`)).json();
  expect(cart.items[0].quantity).toBe(1);
});

test('missing carts, missing items, and repeated removal return useful 404 errors', async () => {
  const missing = await fetch(`${baseUrl}/carts/missing`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: 'CART_NOT_FOUND' } });
  const cartId = await createCart();
  await jsonRequest('POST', `/carts/${cartId}/items`, { productId: 'product-1', quantity: 1 });
  await fetch(`${baseUrl}/carts/${cartId}/items/product-1`, { method: 'DELETE' });
  const repeated = await fetch(`${baseUrl}/carts/${cartId}/items/product-1`, { method: 'DELETE' });
  expect(repeated.status).toBe(404);
  expect(await repeated.json()).toMatchObject({ error: { code: 'CART_ITEM_NOT_FOUND' } });
});

test('malformed JSON, missing bodies, wrong body shapes, and unsupported media types are distinguished', async () => {
  const malformed = await fetch(`${baseUrl}/carts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });
  const missing = await fetch(`${baseUrl}/carts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  for (const body of [[], null, 'hello', 123, { unexpected: true }]) {
    const response = await jsonRequest('POST', '/carts', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  }
  const wrongType = await fetch(`${baseUrl}/carts`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  });
  expect(wrongType.status).toBe(415);
  expect(await wrongType.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
});

test('the JSON parser body limit returns a structured 413 response', async () => {
  const response = await jsonRequest('POST', '/carts', { padding: 'x'.repeat(110000) });
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
});

test.each<Record<string, string>>([
  { 'Content-Type': 'application/json; charset=iso-8859-1' },
  { 'Content-Type': 'application/json', 'Content-Encoding': 'compress' },
])('unsupported JSON transport settings return 415: %j', async (headers) => {
  const response = await fetch(`${baseUrl}/carts`, {
    method: 'POST', headers, body: '{}',
  });
  expect(response.status).toBe(415);
  expect(await response.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
  await createCart();
});

test('an unexpected service failure returns a generic 500 without exposing exception details', async () => {
  const failure = vi.spyOn(CartService.prototype, 'createCart')
    .mockRejectedValueOnce(new Error('private service failure details'));
  try {
    const response = await jsonRequest('POST', '/carts', {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' },
    });
    await createCart();
  } finally {
    failure.mockRestore();
  }
});

test('unknown paths and unsupported methods return JSON 404 responses', async () => {
  for (const [method, path] of [
    ['GET', '/missing'], ['POST', '/products'], ['PUT', '/carts'],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
  }
});
