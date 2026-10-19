import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import type { CartItem, Product } from '../src/domain/types.js';
import { CartService } from '../src/services/carts.js';
import { CouponService } from '../src/services/coupons.js';
import { OrderService } from '../src/services/orders.js';
import { ReportService } from '../src/services/reports.js';
import { InMemoryStore } from '../src/store/memory.js';

function setup(discountPercent = 10, products?: readonly Product[]) {
  const store = new InMemoryStore(products, { couponInterval: 1, discountPercent });
  const carts = new CartService(store);
  const orders = new OrderService(store);
  async function purchase(items: readonly CartItem[], couponCode?: string, key: string = randomUUID()) {
    const cart = await carts.createCart({});
    for (const item of items) await carts.addItem(cart.id, item);
    return orders.checkout(cart.id, couponCode === undefined ? {} : { couponCode }, key);
  }
  return { store, carts, orders, purchase, coupons: new CouponService(store), reports: new ReportService(store) };
}

test('an empty store reports zero totals, zero coupons, and no purchased products', () => {
  const { reports } = setup();
  expect(reports.getReport()).toEqual({
    currency: 'INR', purchasedQuantityByProduct: [], grossRevenuePaise: 0,
    totalDiscountsPaise: 0, netRevenuePaise: 0,
    coupons: { generated: 0, available: 0, redeemed: 0 }, totalOrders: 0,
  });
});

test('mixed purchases reconcile quantities, revenue, discounts, and available/redeemed coupons', async () => {
  const { store, purchase, coupons, reports } = setup();
  const first = await purchase([{ productId: 'product-2', quantity: 2 }]);
  const second = await purchase([{ productId: 'product-1', quantity: 1 }]);
  const applied = await coupons.generate({});
  const unused = await coupons.generate({});
  const third = await purchase([
    { productId: 'product-2', quantity: 3 }, { productId: 'product-1', quantity: 2 },
  ], applied.code);
  const report = reports.getReport();
  expect(report).toEqual({
    currency: 'INR',
    purchasedQuantityByProduct: [
      { productId: 'product-1', quantity: 3 }, { productId: 'product-2', quantity: 5 },
    ],
    grossRevenuePaise: 50000, totalDiscountsPaise: 3250, netRevenuePaise: 46750,
    coupons: { generated: 2, available: 1, redeemed: 1 }, totalOrders: 3,
  });
  const receipts = [first, second, third];
  expect(report.grossRevenuePaise).toBe(receipts.reduce((sum, order) => sum + order.subtotalPaise, 0));
  expect(report.totalDiscountsPaise).toBe(receipts.reduce((sum, order) => sum + order.discountPaise, 0));
  expect(report.netRevenuePaise).toBe(receipts.reduce((sum, order) => sum + order.totalPaise, 0));
  expect(report.grossRevenuePaise - report.totalDiscountsPaise).toBe(report.netRevenuePaise);
  expect(report.coupons.generated).toBe(report.coupons.available + report.coupons.redeemed);
  expect(store.state.coupons.get(applied.code)!.redeemedOrderId).toBe(third.id);
  expect(store.state.coupons.get(unused.code)!.status).toBe('available');
});

test('repeated reports do not mutate state or generate eligible coupons, and returned objects are detached', async () => {
  const { store, purchase, reports } = setup();
  await purchase([{ productId: 'product-1', quantity: 2 }]);
  const state = store.state;
  const before = structuredClone(state);
  const expected = reports.getReport();
  expect(expected.coupons).toEqual({ generated: 0, available: 0, redeemed: 0 });
  const response = reports.getReport();
  (response.purchasedQuantityByProduct[0] as { quantity: number }).quantity = 999;
  (response.coupons as { generated: number }).generated = 999;
  expect(reports.getReport()).toEqual(expected);
  expect(store.state).toBe(state);
  expect(store.state).toEqual(before);
});

test('reporting uses purchase snapshots even after catalog price/name changes or deletion', async () => {
  const { store, purchase, reports } = setup();
  await purchase([{ productId: 'product-1', quantity: 2 }]);
  const expected = reports.getReport();
  const products = new Map(store.state.products);
  products.set('product-1', { ...products.get('product-1')!, name: 'Renamed', unitPricePaise: 99999 });
  store.state = { ...store.state, products };
  expect(reports.getReport()).toEqual(expected);
  store.state = { ...store.state, products: new Map() };
  expect(reports.getReport()).toEqual(expected);
  expect(expected.grossRevenuePaise).toBe(25000);
});

test('failed checkouts, active carts, and successful replays do not add purchases or revenue', async () => {
  const { carts, orders, purchase, reports } = setup();
  const empty = await carts.createCart({});
  await expect(orders.checkout(empty.id, {}, 'failed')).rejects.toThrow(expect.objectContaining({ code: 'EMPTY_CART' }));
  const original = await purchase([{ productId: 'product-1', quantity: 1 }], undefined, 'original');
  await orders.checkout(original.cartId, {}, 'original');
  const active = await carts.createCart({});
  await carts.addItem(active.id, { productId: 'product-2', quantity: 5 });
  await expect(orders.checkout(active.id, { couponCode: 'missing' }, 'invalid')).rejects.toThrow(
    expect.objectContaining({ code: 'INVALID_COUPON' }),
  );
  expect(reports.getReport()).toMatchObject({
    purchasedQuantityByProduct: [{ productId: 'product-1', quantity: 1 }],
    grossRevenuePaise: 12500, totalDiscountsPaise: 0, netRevenuePaise: 12500, totalOrders: 1,
    coupons: { generated: 0, available: 0, redeemed: 0 },
  });
});

test('zero-total orders count as purchases with the full discount in the report', async () => {
  const { purchase, coupons, reports } = setup(100);
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  const coupon = await coupons.generate({});
  await purchase([{ productId: 'product-2', quantity: 1 }], coupon.code);
  expect(reports.getReport()).toEqual({
    currency: 'INR',
    purchasedQuantityByProduct: [
      { productId: 'product-1', quantity: 1 }, { productId: 'product-2', quantity: 1 },
    ],
    grossRevenuePaise: 15000, totalDiscountsPaise: 2500, netRevenuePaise: 12500,
    coupons: { generated: 1, available: 0, redeemed: 1 }, totalOrders: 2,
  });
});

test('safe monetary aggregate boundaries are exact and overflow fails without modifying state', async () => {
  const { store, purchase, reports } = setup(10, [
    { id: 'product-1', name: 'Boundary item', unitPricePaise: Number.MAX_SAFE_INTEGER, availableInventory: 2 },
  ]);
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  expect(reports.getReport().grossRevenuePaise).toBe(Number.MAX_SAFE_INTEGER);
  expect(reports.getReport().netRevenuePaise).toBe(Number.MAX_SAFE_INTEGER);
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  const before = structuredClone(store.state);
  expect(() => reports.getReport()).toThrow(expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }));
  expect(store.state).toEqual(before);
});

test('purchased-quantity aggregation stays exact across restocks and rejects unsafe numeric output', async () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const { store, purchase, reports } = setup(10, [
    { id: 'product-1', name: 'Free item', unitPricePaise: 0, availableInventory: maximum },
  ]);
  await purchase([{ productId: 'product-1', quantity: maximum }]);
  expect(reports.getReport().purchasedQuantityByProduct).toEqual([{ productId: 'product-1', quantity: maximum }]);
  const products = new Map(store.state.products);
  products.set('product-1', { ...products.get('product-1')!, availableInventory: 1 });
  store.state = { ...store.state, products };
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  const before = structuredClone(store.state);
  expect(() => reports.getReport()).toThrow(expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }));
  expect(store.state).toEqual(before);
});

test('a report during queued checkout shows one complete state, then the next read includes the purchase', async () => {
  const { store, carts, orders, purchase, coupons, reports } = setup();
  await purchase([{ productId: 'product-1', quantity: 1 }]);
  const coupon = await coupons.generate({});
  const cart = await carts.createCart({});
  await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
  const before = reports.getReport();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocker = store.mutex.runExclusive(() => gate);
  const checkout = orders.checkout(cart.id, { couponCode: coupon.code }, 'queued');
  expect(reports.getReport()).toEqual(before);
  release();
  await blocker;
  await checkout;
  expect(reports.getReport()).toMatchObject({
    grossRevenuePaise: 25000, totalDiscountsPaise: 1250, netRevenuePaise: 23750,
    coupons: { generated: 1, available: 0, redeemed: 1 }, totalOrders: 2,
  });
});
