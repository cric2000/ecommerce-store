import type { Cart, Order, Product } from '../domain/types.js';
import { seedProducts } from './seed.js';
import { Mutex } from './mutex.js';

interface CheckoutRecord {
  readonly cartId: string;
  readonly orderId: string;
}

export interface StoreState {
  readonly products: ReadonlyMap<string, Product>;
  readonly carts: ReadonlyMap<string, Cart>;
  readonly orders: ReadonlyMap<string, Order>;
  readonly checkoutKeys: ReadonlyMap<string, CheckoutRecord>;
}

export class InMemoryStore {
  readonly mutex = new Mutex();
  state: StoreState;

  constructor(products: readonly Product[] = seedProducts) {
    this.state = {
      products: new Map(products.map((product) => [product.id, { ...product }])),
      carts: new Map(),
      orders: new Map(),
      checkoutKeys: new Map(),
    };
  }
}
