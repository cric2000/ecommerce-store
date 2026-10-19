import { describe, expect, test } from 'vitest';
import type { CartItem, OrderItem, Product } from '../src/domain/types.js';
import { CartService } from '../src/services/carts.js';
import { OrderService } from '../src/services/orders.js';
import { InMemoryStore } from '../src/store/memory.js';

function setup() {
  const store = new InMemoryStore();
  return { store, carts: new CartService(store), orders: new OrderService(store) };
}

function changeProduct(store: InMemoryStore, productId: string, patch: Partial<Product>) {
  const products = new Map(store.state.products);
  products.set(productId, { ...products.get(productId)!, ...patch });
  store.state = { ...store.state, products };
}

function replaceItems(store: InMemoryStore, cartId: string, items: readonly CartItem[]) {
  const carts = new Map(store.state.carts);
  carts.set(cartId, { ...carts.get(cartId)!, items });
  store.state = { ...store.state, carts };
}

function expectUnchanged(store: InMemoryStore, operation: () => unknown, code: string) {
  const original = store.state;
  const before = structuredClone(original);
  expect(operation).toThrow(expect.objectContaining({ code }));
  expect(store.state).toBe(original);
  expect(store.state).toEqual(before);
}

describe('checkout and order snapshots', () => {
  test('places an order, deducts each quantity once, and closes the cart', () => {
    const { store, carts, orders } = setup();
    const cart = carts.createCart({});
    carts.addItem(cart.id, { productId: 'product-2', quantity: 3 });
    carts.addItem(cart.id, { productId: 'product-1', quantity: 2 });
    const order = orders.checkout(cart.id, {});

    expect(order).toMatchObject({
      cartId: cart.id, status: 'placed', currency: 'INR',
      items: [
        { productId: 'product-1', name: 'Notebook', quantity: 2, unitPricePaise: 12500, lineTotalPaise: 25000 },
        { productId: 'product-2', name: 'Pen', quantity: 3, unitPricePaise: 2500, lineTotalPaise: 7500 },
      ],
      subtotalPaise: 32500, coupon: null, discountPaise: 0, totalPaise: 32500,
    });
    expect(new Date(order.createdAt).toISOString()).toBe(order.createdAt);
    expect(store.state.orders.size).toBe(1);
    expect(orders.getOrder(order.id)).toEqual(order);
    expect(store.state.products.get('product-1')!.availableInventory).toBe(48);
    expect(store.state.products.get('product-2')!.availableInventory).toBe(97);
    expect(store.state.products.get('product-3')!.availableInventory).toBe(20);
    expect(carts.getCart(cart.id)).toMatchObject({ status: 'checked_out', orderId: order.id });
  });

  test('a successful cart cannot be checked out again or edited', () => {
    const { store, carts, orders } = setup();
    const cart = carts.createCart({});
    carts.addItem(cart.id, { productId: 'product-5', quantity: 1 });
    orders.checkout(cart.id, {});

    for (const operation of [
      () => orders.checkout(cart.id, {}),
      () => carts.addItem(cart.id, { productId: 'product-1', quantity: 1 }),
      () => carts.updateItem(cart.id, 'product-5', { quantity: 1 }),
      () => carts.removeItem(cart.id, 'product-5'),
    ]) {
      expectUnchanged(store, operation, 'CART_ALREADY_CHECKED_OUT');
    }
    expect(store.state.orders.size).toBe(1);
    expect(store.state.products.get('product-5')!.availableInventory).toBe(0);
  });

  test('missing and empty carts create no orders or inventory changes', () => {
    const { store, carts, orders } = setup();
    const empty = carts.createCart({});
    expectUnchanged(store, () => orders.checkout('missing', {}), 'CART_NOT_FOUND');
    expectUnchanged(store, () => orders.checkout(empty.id, {}), 'EMPTY_CART');
    expect(() => orders.getOrder('missing')).toThrow(expect.objectContaining({ code: 'ORDER_NOT_FOUND' }));
  });

  test.each([null, [], { couponCode: 'not-supported-yet' }, { totalPaise: 0 }])(
    'rejects unsupported checkout body %j before changing state',
    (body) => {
      const { store, carts, orders } = setup();
      const cart = carts.createCart({});
      carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
      expectUnchanged(store, () => orders.checkout(cart.id, body), 'INVALID_REQUEST');
    },
  );

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'revalidates invalid stored quantity %j before committing any line',
    (quantity) => {
      const { store, carts, orders } = setup();
      const cart = carts.createCart({});
      replaceItems(store, cart.id, [
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-2', quantity },
      ]);
      expectUnchanged(store, () => orders.checkout(cart.id, {}), 'INVALID_QUANTITY');
    },
  );

  test('rejects duplicate product lines rather than accepting an invalid stored cart', () => {
    const { store, carts, orders } = setup();
    const cart = carts.createCart({});
    replaceItems(store, cart.id, [
      { productId: 'product-1', quantity: 1 },
      { productId: 'product-1', quantity: 1 },
    ]);
    expectUnchanged(store, () => orders.checkout(cart.id, {}), 'INVALID_REQUEST');
  });

  test('rechecks stock and leaves an earlier valid line unchanged when a later line fails', () => {
    const { store, carts, orders } = setup();
    const cart = carts.createCart({});
    carts.addItem(cart.id, { productId: 'product-1', quantity: 2 });
    carts.addItem(cart.id, { productId: 'product-5', quantity: 1 });
    changeProduct(store, 'product-5', { availableInventory: 0 });

    expectUnchanged(store, () => orders.checkout(cart.id, {}), 'INSUFFICIENT_STOCK');
    expect(store.state.products.get('product-1')!.availableInventory).toBe(50);
    expect(store.state.carts.get(cart.id)!.status).toBe('active');
    expect(store.state.orders.size).toBe(0);
  });

  test('a product disappearing after add fails without partially deducting other products', () => {
    const { store, carts, orders } = setup();
    const cart = carts.createCart({});
    carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    carts.addItem(cart.id, { productId: 'product-2', quantity: 1 });
    const products = new Map(store.state.products);
    products.delete('product-2');
    store.state = { ...store.state, products };
    expectUnchanged(store, () => orders.checkout(cart.id, {}), 'PRODUCT_NOT_FOUND');
  });

  test.each(['line', 'subtotal'])(
    'rejects %s overflow after a price change without changing state',
    (scenario) => {
      const { store, carts, orders } = setup();
      const cart = carts.createCart({});
      carts.addItem(cart.id, { productId: 'product-1', quantity: scenario === 'line' ? 2 : 1 });
      carts.addItem(cart.id, { productId: 'product-2', quantity: 1 });
      changeProduct(store, 'product-1', { unitPricePaise: Number.MAX_SAFE_INTEGER });
      expectUnchanged(store, () => orders.checkout(cart.id, {}), 'AMOUNT_OUT_OF_RANGE');
    },
  );

  test('uses the price/name at checkout and preserves the snapshot after later catalog changes or deletion', () => {
    const { store, carts, orders } = setup();
    const cart = carts.createCart({});
    carts.addItem(cart.id, { productId: 'product-1', quantity: 2 });
    changeProduct(store, 'product-1', { name: 'Updated notebook', unitPricePaise: 7500 });
    const order = orders.checkout(cart.id, {});
    expect(order.items[0]).toEqual({
      productId: 'product-1', name: 'Updated notebook', quantity: 2,
      unitPricePaise: 7500, lineTotalPaise: 15000,
    });
    expect(order.totalPaise).toBe(15000);

    changeProduct(store, 'product-1', { name: 'Later name', unitPricePaise: 99999, availableInventory: 0 });
    expect(orders.getOrder(order.id)).toEqual(order);
    const products = new Map(store.state.products);
    products.delete('product-1');
    store.state = { ...store.state, products };
    expect(orders.getOrder(order.id)).toEqual(order);
  });

  test('checkout and retrieval return detached copies of the stored order', () => {
    const { carts, orders } = setup();
    const cart = carts.createCart({});
    carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    const created = orders.checkout(cart.id, {});
    const original = structuredClone(created);
    (created.items[0] as { name: string }).name = 'Changed by caller';
    const fetched = orders.getOrder(created.id);
    expect(fetched).toEqual(original);
    (fetched.items as OrderItem[]).pop();
    expect(orders.getOrder(created.id)).toEqual(original);
  });

  test('zero-priced items produce a valid zero-total placed order', () => {
    const { store, carts, orders } = setup();
    changeProduct(store, 'product-1', { unitPricePaise: 0 });
    const cart = carts.createCart({});
    carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    expect(orders.checkout(cart.id, {})).toMatchObject({
      status: 'placed', subtotalPaise: 0, discountPaise: 0, totalPaise: 0,
    });
    expect(store.state.orders.size).toBe(1);
    expect(store.state.products.get('product-1')!.availableInventory).toBe(49);
  });
});
