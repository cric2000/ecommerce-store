import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run against a fresh server with the default seed, interval 5, and discount 10.
const baseUrl = process.argv[2] ?? 'http://localhost:3000';

async function request(method, path, { body, key, status = 200 } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key === undefined ? {} : { 'Idempotency-Key': key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
  if (status === 201 && (path === '/carts' || path.endsWith('/checkout'))) {
    const resource = path === '/carts' ? 'carts' : 'orders';
    assert.equal(response.headers.get('location'), `/${resource}/${value.id}`);
  }
  return value;
}

assert.deepEqual(await request('GET', '/health'), { status: 'ok' });
const initialReport = await request('GET', '/admin/report');
assert.equal(initialReport.totalOrders, 0, 'Restart the server before running this example');
const catalog = await request('GET', '/products');
assert.equal(catalog.currency, 'INR');
assert.equal(catalog.products.length, 5);

// Five undiscounted notebook purchases reach the first reward milestone.
for (let index = 0; index < 5; index++) {
  const cart = await request('POST', '/carts', { body: {}, status: 201 });
  const path = `/carts/${cart.id}`;
  if (index === 0) {
    await request('POST', `${path}/items`, { body: { productId: 'product-1', quantity: 2 } });
    const updated = await request('PATCH', `${path}/items/product-1`, { body: { quantity: 3 } });
    assert.equal(updated.subtotalPaise, 37500);
    const removed = await request('DELETE', `${path}/items/product-1`);
    assert.deepEqual(removed.items, []);
  }
  const added = await request('POST', `${path}/items`, { body: { productId: 'product-1', quantity: 1 } });
  assert.deepEqual(await request('GET', path), added);
  const order = await request('POST', `${path}/checkout`, { body: {}, key: randomUUID(), status: 201 });
  assert.equal(order.totalPaise, 12500);
}

const coupon = await request('POST', '/admin/coupons', { body: {}, status: 201 });
assert.equal(coupon.milestone, 5);
assert.equal(coupon.discountPercent, 10);

// Redeem the coupon on two pens, then retry with the same key and body.
const cart = await request('POST', '/carts', { body: {}, status: 201 });
const path = `/carts/${cart.id}`;
await request('POST', `${path}/items`, { body: { productId: 'product-2', quantity: 2 } });
const checkout = { body: { couponCode: coupon.code }, key: randomUUID(), status: 201 };
const order = await request('POST', `${path}/checkout`, checkout);
assert.equal(order.subtotalPaise, 5000);
assert.equal(order.discountPaise, 500);
assert.equal(order.totalPaise, 4500);
assert.deepEqual(await request('POST', `${path}/checkout`, checkout), order);
assert.deepEqual(await request('GET', `/orders/${order.id}`), order);
const closed = await request('GET', path);
assert.equal(closed.status, 'checked_out');
assert.equal(closed.orderId, order.id);

const report = await request('GET', '/admin/report');
assert.deepEqual(report, {
  currency: 'INR',
  purchasedQuantityByProduct: [
    { productId: 'product-1', quantity: 5 },
    { productId: 'product-2', quantity: 2 },
  ],
  grossRevenuePaise: 67500,
  totalDiscountsPaise: 500,
  netRevenuePaise: 67000,
  coupons: { generated: 1, available: 0, redeemed: 1 },
  totalOrders: 6,
});
assert.deepEqual(await request('GET', '/admin/report'), report);
const remaining = await request('GET', '/products');
assert.equal(remaining.products.find((product) => product.id === 'product-1').availableInventory, 45);
assert.equal(remaining.products.find((product) => product.id === 'product-2').availableInventory, 98);
console.log('API example passed: cart edits, six orders, coupon redemption, retry, and report.');
console.log(JSON.stringify(report, null, 2));
