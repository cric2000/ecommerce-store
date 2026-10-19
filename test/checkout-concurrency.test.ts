import { expect, test } from 'vitest';
import { CartService } from '../src/services/carts.js';
import { OrderService } from '../src/services/orders.js';
import { InMemoryStore } from '../src/store/memory.js';

function setup() {
  const store = new InMemoryStore();
  return { store, carts: new CartService(store), orders: new OrderService(store) };
}

test('two carts competing for the last item produce exactly one purchase', async () => {
  const { store, carts, orders } = setup();
  const first = await carts.createCart({});
  const second = await carts.createCart({});
  for (const cart of [first, second]) {
    await carts.addItem(cart.id, { productId: 'product-5', quantity: 1 });
  }
  const results = await Promise.allSettled([
    orders.checkout(first.id, {}, 'first-key'),
    orders.checkout(second.id, {}, 'second-key'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const failed = results.find((result) => result.status === 'rejected');
  expect(failed).toMatchObject({ reason: { code: 'INSUFFICIENT_STOCK' } });
  expect(store.state.products.get('product-5')!.availableInventory).toBe(0);
  expect(store.state.orders.size).toBe(1);
  expect(store.state.checkoutKeys.size).toBe(1);
  expect([...store.state.carts.values()].filter((cart) => cart.status === 'active')).toHaveLength(1);
});

test('simultaneous matching keys return the same order and deduct inventory once', async () => {
  const { store, carts, orders } = setup();
  const cart = await carts.createCart({});
  await carts.addItem(cart.id, { productId: 'product-5', quantity: 1 });
  const results = await Promise.all(Array.from({ length: 12 }, () => (
    orders.checkout(cart.id, {}, 'same-key')
  )));
  for (const order of results) expect(order).toEqual(results[0]);
  expect(store.state.orders.size).toBe(1);
  expect(store.state.checkoutKeys.size).toBe(1);
  expect(store.state.products.get('product-5')!.availableInventory).toBe(0);
});

test('simultaneous requests cannot bind one key to different carts', async () => {
  const { store, carts, orders } = setup();
  const first = await carts.createCart({});
  const second = await carts.createCart({});
  for (const cart of [first, second]) {
    await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
  }
  const results = await Promise.allSettled([
    orders.checkout(first.id, {}, 'shared-key'),
    orders.checkout(second.id, {}, 'shared-key'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected'))
    .toMatchObject({ reason: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  expect(store.state.orders.size).toBe(1);
  expect(store.state.products.get('product-1')!.availableInventory).toBe(49);
});

test('different keys competing for the same cart create one order and bind only the winning key', async () => {
  const { store, carts, orders } = setup();
  const cart = await carts.createCart({});
  await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
  const keys = ['first-attempt', 'second-attempt'];
  const results = await Promise.allSettled(keys.map((key) => orders.checkout(cart.id, {}, key)));
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected'))
    .toMatchObject({ reason: { code: 'CART_ALREADY_CHECKED_OUT' } });
  expect(store.state.orders.size).toBe(1);
  expect(store.state.checkoutKeys.size).toBe(1);
  for (const [index, result] of results.entries()) {
    expect(store.state.checkoutKeys.has(keys[index])).toBe(result.status === 'fulfilled');
  }
  expect(store.state.products.get('product-1')!.availableInventory).toBe(49);
  expect(carts.getCart(cart.id)).toMatchObject({ status: 'checked_out' });
});

test('a failed attempt does not bind its key and the fixed cart can retry', async () => {
  const { store, carts, orders } = setup();
  const cart = await carts.createCart({});
  await expect(orders.checkout(cart.id, {}, 'retry-key')).rejects.toThrow(
    expect.objectContaining({ code: 'EMPTY_CART' }),
  );
  expect(store.state.checkoutKeys.size).toBe(0);
  await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
  const order = await orders.checkout(cart.id, {}, 'retry-key');
  expect(await orders.checkout(cart.id, {}, 'retry-key')).toEqual(order);
  expect(store.state.orders.size).toBe(1);
});

test('a key from a failed attempt may be used for a different request', async () => {
  const { store, carts, orders } = setup();
  const empty = await carts.createCart({});
  await expect(orders.checkout(empty.id, {}, 'unbound-key')).rejects.toThrow(
    expect.objectContaining({ code: 'EMPTY_CART' }),
  );
  const another = await carts.createCart({});
  await carts.addItem(another.id, { productId: 'product-1', quantity: 1 });
  expect((await orders.checkout(another.id, {}, 'unbound-key')).cartId).toBe(another.id);
  expect(store.state.checkoutKeys.size).toBe(1);
});

test('successful replay precedes live catalog validation and does not mutate state', async () => {
  const { store, carts, orders } = setup();
  const cart = await carts.createCart({});
  await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
  const original = await orders.checkout(cart.id, {}, 'original-key');
  const products = new Map(store.state.products);
  products.delete('product-1');
  store.state = { ...store.state, products };
  const before = store.state;
  expect(await orders.checkout(cart.id, {}, 'original-key')).toEqual(original);
  expect(store.state).toBe(before);
});

test('cart edits and checkout wait on the same store lock', async () => {
  const { store, carts, orders } = setup();
  const cart = await carts.createCart({});
  await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
  const before = store.state;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocker = store.mutex.runExclusive(() => gate);
  const results = Promise.allSettled([
    orders.checkout(cart.id, {}, 'blocked-key'),
    carts.updateItem(cart.id, 'product-1', { quantity: 2 }),
  ]);
  await Promise.resolve();
  expect(store.state).toBe(before);
  release();
  await blocker;
  const [checkout, edit] = await results;
  expect(checkout).toMatchObject({ status: 'fulfilled', value: { items: [{ quantity: 1 }] } });
  expect(edit).toMatchObject({ status: 'rejected', reason: { code: 'CART_ALREADY_CHECKED_OUT' } });
  expect(store.state.products.get('product-1')!.availableInventory).toBe(49);
});

test('checkout reads current stock after acquiring the lock, not before waiting', async () => {
  const { store, carts, orders } = setup();
  const cart = await carts.createCart({});
  await carts.addItem(cart.id, { productId: 'product-5', quantity: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocker = store.mutex.runExclusive(async () => {
    await gate;
    const products = new Map(store.state.products);
    products.set('product-5', { ...products.get('product-5')!, availableInventory: 0 });
    store.state = { ...store.state, products };
  });
  const result = orders.checkout(cart.id, {}, 'wait-key');
  const assertion = expect(result).rejects.toThrow(expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }));
  release();
  await blocker;
  await assertion;
  expect(store.state.orders.size).toBe(0);
  expect(store.state.checkoutKeys.size).toBe(0);
});

test.each([undefined, null, 123, [], '', 'bad key', 'key\n', 'x'.repeat(129)])(
  'rejects invalid checkout key %j without creating an order', async (key) => {
    const { store, carts, orders } = setup();
    const cart = await carts.createCart({});
    await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    const before = store.state;
    await expect(orders.checkout(cart.id, {}, key)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_IDEMPOTENCY_KEY' }),
    );
    expect(store.state).toBe(before);
  },
);

test('accepts key-format boundaries without coercion', async () => {
  const { carts, orders } = setup();
  for (const key of ['a', 'A_0.:-', 'x'.repeat(128)]) {
    const cart = await carts.createCart({});
    await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    expect((await orders.checkout(cart.id, {}, key)).cartId).toBe(cart.id);
  }
});
