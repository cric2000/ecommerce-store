import type { Cart, Product } from '../domain/types.js';
import { seedProducts } from './seed.js';

export interface StoreState {
  readonly products: ReadonlyMap<string, Product>;
  readonly carts: ReadonlyMap<string, Cart>;
}

export class InMemoryStore {
  state: StoreState;

  constructor(products: readonly Product[] = seedProducts) {
    this.state = {
      products: new Map(products.map((product) => [product.id, { ...product }])),
      carts: new Map(),
    };
  }
}
