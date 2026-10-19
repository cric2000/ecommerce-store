import { describe, expect, test } from 'vitest';
import type { Product } from '../src/domain/types.js';
import { CartService } from '../src/services/carts.js';
import { CatalogService } from '../src/services/catalog.js';
import { InMemoryStore } from '../src/store/memory.js';

function setup() {
  const store = new InMemoryStore();
  return { store, carts: new CartService(store), catalog: new CatalogService(store) };
}

// Simulate catalog changes internally; there is no catalog mutation HTTP endpoint.
function changeProduct(store: InMemoryStore, productId: string, patch: Partial<Product>) {
  const products = new Map(store.state.products);
  products.set(productId, { ...products.get(productId)!, ...patch });
  store.state = { ...store.state, products };
}

describe('catalog and cart lifecycle', () => {
  test('seeds five sorted products including a single-stock item', async () => {
    const { catalog } = setup();
    const result = catalog.listProducts();
    expect(result.currency).toBe('INR');
    expect(result.products.map((product) => product.id)).toEqual([
      'product-1', 'product-2', 'product-3', 'product-4', 'product-5',
    ]);
    expect(result.products.find((product) => product.id === 'product-5')).toMatchObject({
      availableInventory: 1,
    });
  });

  test('creates, retrieves, increments, sets quantities, and removes items with exact totals', async () => {
    const { carts, catalog } = setup();
    const cart = await carts.createCart({});
    expect(cart).toMatchObject({
      status: 'active', orderId: null, currency: 'INR', items: [], subtotalPaise: 0,
    });
    expect((await carts.createCart({})).id).not.toBe(cart.id);
    const initialCatalog = catalog.listProducts();

    await carts.addItem(cart.id, { productId: 'product-2', quantity: 1 });
    const added = await carts.addItem(cart.id, { productId: 'product-1', quantity: 2 });
    expect(added.items.map((item) => item.productId)).toEqual(['product-1', 'product-2']);
    expect(added.items[0]).toMatchObject({
      name: 'Notebook', quantity: 2, unitPricePaise: 12500, lineTotalPaise: 25000,
      availableInventory: 50, isAvailable: true,
    });
    expect(added.subtotalPaise).toBe(27500);
    expect((await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 })).subtotalPaise)
      .toBe(40000);
    const updated = await carts.updateItem(cart.id, 'product-1', { quantity: 1 });
    expect(updated.items).toHaveLength(2);
    expect(updated.subtotalPaise).toBe(15000);
    expect(carts.getCart(cart.id)).toEqual(updated);
    expect((await carts.removeItem(cart.id, 'product-2')).subtotalPaise).toBe(12500);
    expect(await carts.removeItem(cart.id, 'product-1')).toMatchObject({
      items: [], subtotalPaise: 0,
    });
    expect(catalog.listProducts()).toEqual(initialCatalog);
  });

  test.each([0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1, null, undefined])(
    'invalid quantity %j changes neither the cart nor the store',
    async (quantity) => {
      const { store, carts } = setup();
      const cart = await carts.createCart({});
      await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
      const before = store.state;
      for (const operation of [
        () => carts.addItem(cart.id, { productId: 'product-1', quantity }),
        () => carts.updateItem(cart.id, 'product-1', { quantity }),
      ]) {
        await expect(operation()).rejects.toThrow(expect.objectContaining({ code: 'INVALID_QUANTITY' }));
        expect(store.state).toBe(before);
      }
    },
  );

  test('rejects unknown products and body properties without saving anything', async () => {
    const { store, carts } = setup();
    const cart = await carts.createCart({});
    const before = store.state;
    await expect(carts.addItem(cart.id, { productId: 'missing', quantity: 1 })).rejects
      .toThrow(expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }));
    await expect(carts.addItem(cart.id, { productId: '', quantity: 1 })).rejects
      .toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    await expect(carts.addItem(cart.id, { productId: 'product-1', quantity: 1, price: 0 })).rejects
      .toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    await expect(carts.createCart({ items: [] })).rejects
      .toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(store.state).toBe(before);
  });

  test('checks resulting stock on add and update, preserving the existing line on failure', async () => {
    const { store, carts } = setup();
    const cart = await carts.createCart({});
    await carts.addItem(cart.id, { productId: 'product-5', quantity: 1 });
    const before = store.state;
    for (const operation of [
      () => carts.addItem(cart.id, { productId: 'product-5', quantity: 1 }),
      () => carts.updateItem(cart.id, 'product-5', { quantity: 2 }),
    ]) {
      await expect(operation()).rejects.toThrow(expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
        details: { productId: 'product-5', requestedQuantity: 2, availableInventory: 1 },
      }));
      expect(store.state).toBe(before);
    }
    expect(carts.getCart(cart.id).items[0].quantity).toBe(1);
  });

  test('does not reserve inventory when two carts contain the last item', async () => {
    const { carts, catalog } = setup();
    const first = await carts.createCart({});
    const second = await carts.createCart({});
    for (const cart of [first, second]) {
      expect((await carts.addItem(cart.id, { productId: 'product-5', quantity: 1 })).items[0])
        .toMatchObject({ availableInventory: 1, isAvailable: true });
    }
    expect(catalog.listProducts().products[4].availableInventory).toBe(1);
  });

  test('reads current prices and flags reduced stock without silently changing quantities', async () => {
    const { store, carts } = setup();
    const cart = await carts.createCart({});
    await carts.addItem(cart.id, { productId: 'product-1', quantity: 2 });
    changeProduct(store, 'product-1', { unitPricePaise: 7500, availableInventory: 1 });

    const view = carts.getCart(cart.id);
    expect(view.items[0]).toMatchObject({
      quantity: 2, unitPricePaise: 7500, lineTotalPaise: 15000,
      availableInventory: 1, isAvailable: false,
    });
    expect(view.subtotalPaise).toBe(15000);
    expect((await carts.updateItem(cart.id, 'product-1', { quantity: 1 })).items[0].isAvailable)
      .toBe(true);
    changeProduct(store, 'product-1', { availableInventory: 0 });
    expect(carts.getCart(cart.id).items[0].isAvailable).toBe(false);
    expect((await carts.removeItem(cart.id, 'product-1')).items).toEqual([]);
  });

  test('pricing overflow during a proposed change leaves the stored cart unchanged', async () => {
    const { store, carts } = setup();
    const cart = await carts.createCart({});
    await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    changeProduct(store, 'product-1', { unitPricePaise: Number.MAX_SAFE_INTEGER });
    const before = store.state;
    for (const productId of ['product-1', 'product-2']) {
      await expect(carts.addItem(cart.id, { productId, quantity: 1 })).rejects
        .toThrow(expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }));
      expect(store.state).toBe(before);
    }
    expect(carts.getCart(cart.id).items).toHaveLength(1);
    expect(carts.getCart(cart.id).items[0].quantity).toBe(1);
  });

  test('returned views and catalog objects do not expose mutable store records', async () => {
    const { carts, catalog } = setup();
    const cart = await carts.createCart({});
    const view = await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    (view.items[0] as { quantity: number }).quantity = 999;
    (catalog.listProducts().products[0] as { unitPricePaise: number }).unitPricePaise = 0;
    expect(carts.getCart(cart.id).items[0]).toMatchObject({ quantity: 1, unitPricePaise: 12500 });
    expect(catalog.listProducts().products[0].unitPricePaise).toBe(12500);
    expect(() => new CartService(new InMemoryStore()).getCart(cart.id))
      .toThrow(expect.objectContaining({ code: 'CART_NOT_FOUND' }));
  });

  test('distinguishes missing carts, products, and cart items', async () => {
    const { carts } = setup();
    const cart = await carts.createCart({});
    expect(() => carts.getCart('missing'))
      .toThrow(expect.objectContaining({ code: 'CART_NOT_FOUND' }));
    await expect(carts.updateItem(cart.id, 'product-1', { quantity: 1 })).rejects
      .toThrow(expect.objectContaining({ code: 'CART_ITEM_NOT_FOUND' }));
    await expect(carts.updateItem(cart.id, 'missing', { quantity: 1 })).rejects
      .toThrow(expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }));
    await expect(carts.removeItem(cart.id, 'product-1')).rejects
      .toThrow(expect.objectContaining({ code: 'CART_ITEM_NOT_FOUND' }));
  });

  test('checked-out cart fixtures remain readable but reject all item mutations', async () => {
    const { store, carts } = setup();
    const cart = await carts.createCart({});
    const records = new Map(store.state.carts);
    records.set(cart.id, { id: cart.id, items: [], status: 'checked_out', orderId: 'order-fixture' });
    store.state = { ...store.state, carts: records };
    expect(carts.getCart(cart.id)).toMatchObject({
      status: 'checked_out', orderId: 'order-fixture',
    });
    for (const operation of [
      () => carts.addItem(cart.id, { productId: 'product-1', quantity: 1 }),
      () => carts.updateItem(cart.id, 'product-1', { quantity: 1 }),
      () => carts.removeItem(cart.id, 'product-1'),
    ]) {
      await expect(operation()).rejects.toThrow(expect.objectContaining({ code: 'CART_ALREADY_CHECKED_OUT' }));
    }
  });

  test('a disappeared product gives a clear read error and its line can still be removed', async () => {
    const { store, carts } = setup();
    const cart = await carts.createCart({});
    await carts.addItem(cart.id, { productId: 'product-1', quantity: 1 });
    const products = new Map(store.state.products);
    products.delete('product-1');
    store.state = { ...store.state, products };
    expect(() => carts.getCart(cart.id))
      .toThrow(expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }));
    expect((await carts.removeItem(cart.id, 'product-1')).items).toEqual([]);
  });
});
