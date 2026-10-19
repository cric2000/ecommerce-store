import type { Product } from '../domain/types.js';
import type { InMemoryStore } from '../store/memory.js';

export class CatalogService {
  constructor(private readonly store: InMemoryStore) {}

  listProducts(): { currency: 'INR'; products: Product[] } {
    const products = [...this.store.state.products.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((product) => ({ ...product }));

    return { currency: 'INR', products };
  }
}
