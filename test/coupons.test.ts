import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import type { Product } from '../src/domain/types.js';
import { CartService } from '../src/services/carts.js';
import { CouponService } from '../src/services/coupons.js';
import { OrderService } from '../src/services/orders.js';
import { InMemoryStore } from '../src/store/memory.js';

function setup(couponInterval = 2, discountPercent = 10, products?: readonly Product[]) {
  const store = new InMemoryStore(products, { couponInterval, discountPercent });
  return { store, carts: new CartService(store), orders: new OrderService(store), coupons: new CouponService(store) };
}

async function readyCart(carts: CartService, productId = 'product-1') {
  const cart = await carts.createCart({});
  await carts.addItem(cart.id, { productId, quantity: 1 });
  return cart;
}

async function purchase(carts: CartService, orders: OrderService, key: string = randomUUID()) {
  const cart = await readyCart(carts);
  return orders.checkout(cart.id, {}, key);
}

test('only successful order milestones permit generation, with one coupon per milestone and coexistence', async () => {
  const { store, carts, orders, coupons } = setup();
  await expect(coupons.generate({})).rejects.toThrow(expect.objectContaining({ code: 'NO_ELIGIBLE_MILESTONE' }));
  const empty = await carts.createCart({});
  await expect(orders.checkout(empty.id, {}, 'failed')).rejects.toThrow(expect.objectContaining({ code: 'EMPTY_CART' }));
  const first = await purchase(carts, orders, 'first');
  await orders.checkout(first.cartId, {}, 'first');
  await expect(coupons.generate({})).rejects.toThrow(expect.objectContaining({ code: 'NO_ELIGIBLE_MILESTONE' }));
  await purchase(carts, orders);
  const secondMilestone = await coupons.generate({});
  expect(secondMilestone).toMatchObject({ milestone: 2, discountPercent: 10, status: 'available', redeemedOrderId: null });
  await expect(coupons.generate({})).rejects.toThrow(expect.objectContaining({ code: 'NO_ELIGIBLE_MILESTONE' }));
  await purchase(carts, orders);
  await purchase(carts, orders);
  const fourthMilestone = await coupons.generate({});
  expect(fourthMilestone.milestone).toBe(4);
  expect(fourthMilestone.code).not.toBe(secondMilestone.code);
  expect([...store.state.coupons.values()].map((coupon) => coupon.status)).toEqual(['available', 'available']);
  expect(store.state.orders.size).toBe(4);
  (secondMilestone as { discountPercent: number }).discountPercent = 99;
  expect(store.state.coupons.get(secondMilestone.code)!.discountPercent).toBe(10);
});

test('concurrent generation issues different outstanding milestones, never duplicate coupons', async () => {
  const { store, carts, orders, coupons } = setup();
  for (let i = 0; i < 4; i++) await purchase(carts, orders);
  const results = await Promise.allSettled([coupons.generate({}), coupons.generate({}), coupons.generate({})]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
  expect(results.find((result) => result.status === 'rejected'))
    .toMatchObject({ reason: { code: 'NO_ELIGIBLE_MILESTONE' } });
  expect([...store.state.coupons.values()].map((coupon) => coupon.milestone).sort()).toEqual([2, 4]);
});

test('generation waits on the checkout lock and sees the milestone committed ahead of it', async () => {
  const { store, carts, orders, coupons } = setup(1);
  const cart = await readyCart(carts);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocker = store.mutex.runExclusive(() => gate);
  const results = Promise.allSettled([
    orders.checkout(cart.id, {}, 'queued-purchase'),
    coupons.generate({}),
  ]);
  await Promise.resolve();
  expect(store.state.orders.size).toBe(0);
  expect(store.state.coupons.size).toBe(0);
  release();
  await blocker;
  const [checkout, generation] = await results;
  expect(checkout.status).toBe('fulfilled');
  expect(generation).toMatchObject({ status: 'fulfilled', value: { milestone: 1 } });
  expect(store.state.coupons.size).toBe(1);
});

test('discounts round half up, redemption links to the order, and the snapshot is detached', async () => {
  const products = [{ id: 'product-1', name: 'Tiny item', unitPricePaise: 105, availableInventory: 10 }];
  const { store, carts, orders, coupons } = setup(1, 10, products);
  await purchase(carts, orders);
  const coupon = await coupons.generate({});
  const cart = await readyCart(carts);
  const order = await orders.checkout(cart.id, { couponCode: coupon.code }, 'discounted');
  expect(order).toMatchObject({
    subtotalPaise: 105, discountPaise: 11, totalPaise: 94,
    coupon: { code: coupon.code, milestone: 1, discountPercent: 10 },
  });
  expect(store.state.coupons.get(coupon.code)).toMatchObject({ status: 'redeemed', redeemedOrderId: order.id });
  (order.coupon as { discountPercent: number }).discountPercent = 99;
  expect(orders.getOrder(order.id).coupon!.discountPercent).toBe(10);
  expect(store.state.coupons.get(coupon.code)!.discountPercent).toBe(10);
});

test('redemption never reopens the same milestone for generation', async () => {
  const { store, carts, orders, coupons } = setup(2);
  await purchase(carts, orders);
  await purchase(carts, orders);
  const coupon = await coupons.generate({});
  const cart = await readyCart(carts);
  await orders.checkout(cart.id, { couponCode: coupon.code }, 'redeem');
  await expect(coupons.generate({})).rejects.toThrow(expect.objectContaining({ code: 'NO_ELIGIBLE_MILESTONE' }));
  expect(store.state.coupons.size).toBe(1);
});

test('invalid and redeemed coupons fail without changing order, inventory, cart, or key state', async () => {
  const { store, carts, orders, coupons } = setup(1);
  await purchase(carts, orders);
  const coupon = await coupons.generate({});
  const cart = await readyCart(carts);
  for (const code of ['missing', `${coupon.code} `]) {
    const before = structuredClone(store.state);
    await expect(orders.checkout(cart.id, { couponCode: code }, 'not-bound')).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_COUPON' }),
    );
    expect(store.state).toEqual(before);
  }
  await orders.checkout(cart.id, { couponCode: coupon.code }, 'redeem');
  const another = await readyCart(carts);
  const before = structuredClone(store.state);
  await expect(orders.checkout(another.id, { couponCode: coupon.code }, 'again')).rejects.toThrow(
    expect.objectContaining({ code: 'COUPON_ALREADY_REDEEMED' }),
  );
  expect(store.state).toEqual(before);
});

test.each([null, [], '', ' ', 'x'.repeat(129), 123, undefined])('rejects invalid coupon value %j', async (couponCode) => {
  const { store, carts, orders } = setup();
  const cart = await readyCart(carts);
  const before = store.state;
  await expect(orders.checkout(cart.id, { couponCode }, 'invalid')).rejects.toThrow(
    expect.objectContaining({ code: 'INVALID_REQUEST' }),
  );
  expect(store.state).toBe(before);
});

test('failed stock validation preserves the coupon and the same key can retry after repair', async () => {
  const { store, carts, orders, coupons } = setup(1);
  await purchase(carts, orders);
  const coupon = await coupons.generate({});
  const cart = await readyCart(carts);
  const products = new Map(store.state.products);
  const product = products.get('product-1')!;
  products.set(product.id, { ...product, availableInventory: 0 });
  store.state = { ...store.state, products };
  const before = structuredClone(store.state);
  await expect(orders.checkout(cart.id, { couponCode: coupon.code }, 'repair')).rejects.toThrow(
    expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }),
  );
  expect(store.state).toEqual(before);
  expect(store.state.coupons.get(coupon.code)!.status).toBe('available');
  const repaired = new Map(store.state.products);
  repaired.set(product.id, { ...product, availableInventory: 1 });
  store.state = { ...store.state, products: repaired };
  const order = await orders.checkout(cart.id, { couponCode: coupon.code }, 'repair');
  expect(store.state.coupons.get(coupon.code)).toMatchObject({ status: 'redeemed', redeemedOrderId: order.id });
});

test('money failure after line preparation preserves the coupon and all staged deductions', async () => {
  const { store, carts, orders, coupons } = setup(1);
  await purchase(carts, orders);
  const coupon = await coupons.generate({});
  const cart = await readyCart(carts);
  await carts.addItem(cart.id, { productId: 'product-2', quantity: 1 });
  const products = new Map(store.state.products);
  products.set('product-1', { ...products.get('product-1')!, unitPricePaise: Number.MAX_SAFE_INTEGER });
  store.state = { ...store.state, products };
  const before = structuredClone(store.state);
  await expect(orders.checkout(cart.id, { couponCode: coupon.code }, 'overflow')).rejects.toThrow(
    expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }),
  );
  expect(store.state).toEqual(before);
});

test('two checkouts cannot redeem one coupon and the losing key remains usable', async () => {
  const { store, carts, orders, coupons } = setup(1);
  await purchase(carts, orders);
  const coupon = await coupons.generate({});
  const first = await readyCart(carts, 'product-2');
  const second = await readyCart(carts, 'product-2');
  const attempts = [first, second].map((cart, index) => (
    orders.checkout(cart.id, { couponCode: coupon.code }, `compete-${index}`)
  ));
  const results = await Promise.allSettled(attempts);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const loser = results.findIndex((result) => result.status === 'rejected');
  expect(results[loser]).toMatchObject({ reason: { code: 'COUPON_ALREADY_REDEEMED' } });
  expect(store.state.orders.size).toBe(2);
  expect(store.state.products.get('product-2')!.availableInventory).toBe(99);
  expect(store.state.checkoutKeys.size).toBe(2);
  const retry = await orders.checkout([first, second][loser].id, {}, `compete-${loser}`);
  expect(retry.coupon).toBeNull();
});

test('matching coupon retries redeem once; adding, removing, or changing the code conflicts', async () => {
  const { store, carts, orders, coupons } = setup(1);
  const original = await purchase(carts, orders, 'earning-key');
  const first = await coupons.generate({});
  await expect(orders.checkout(original.cartId, { couponCode: first.code }, 'earning-key')).rejects.toThrow(
    expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
  );
  await purchase(carts, orders);
  const second = await coupons.generate({});
  const cart = await readyCart(carts);
  const results = await Promise.all(Array.from({ length: 10 }, () => (
    orders.checkout(cart.id, { couponCode: first.code }, 'repeated')
  )));
  for (const order of results) expect(order).toEqual(results[0]);
  expect(store.state.orders.size).toBe(3);
  expect(store.state.products.get('product-1')!.availableInventory).toBe(47);
  for (const body of [{}, { couponCode: second.code }]) {
    await expect(orders.checkout(cart.id, body, 'repeated')).rejects.toThrow(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_CONFLICT' }),
    );
  }
  expect(store.state.coupons.get(second.code)!.status).toBe('available');
  expect(await orders.checkout(cart.id, { couponCode: first.code }, 'repeated')).toEqual(results[0]);
});

test('100 percent discounts produce zero totals, count as success, and redeem only once', async () => {
  const { store, carts, orders, coupons } = setup(1, 100);
  await purchase(carts, orders);
  const coupon = await coupons.generate({});
  const cart = await readyCart(carts);
  const order = await orders.checkout(cart.id, { couponCode: coupon.code }, 'free');
  expect(order).toMatchObject({ subtotalPaise: 12500, discountPaise: 12500, totalPaise: 0, status: 'placed' });
  expect(store.state.coupons.get(coupon.code)!.status).toBe('redeemed');
  expect((await coupons.generate({})).milestone).toBe(2);
});
