import { InMemoryStore } from './memory.js';

export interface StoreAccess {
  read<T>(operation: (store: InMemoryStore) => T): Promise<T>;
  write<T>(operation: (store: InMemoryStore) => T | Promise<T>): Promise<T>;
}

export class MemoryStoreAccess implements StoreAccess {
  constructor(private readonly store: InMemoryStore) {}

  async read<T>(operation: (store: InMemoryStore) => T): Promise<T> {
    return operation(this.store);
  }

  async write<T>(operation: (store: InMemoryStore) => T | Promise<T>): Promise<T> {
    return operation(this.store);
  }
}
