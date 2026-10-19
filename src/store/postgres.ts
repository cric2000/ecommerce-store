import { attachDatabasePool } from '@vercel/functions';
import { Pool, type PoolClient } from 'pg';
import type { RewardConfig } from '../config.js';
import type { Cart, Coupon, Order, Product } from '../domain/types.js';
import type { StoreAccess } from './access.js';
import { InMemoryStore, type CheckoutRecord } from './memory.js';

interface Snapshot {
  rewards: RewardConfig;
  products: Product[];
  carts: Cart[];
  orders: Order[];
  checkoutKeys: [string, CheckoutRecord][];
  coupons: Coupon[];
}

function snapshot(store: InMemoryStore): Snapshot {
  const { products, carts, orders, checkoutKeys, coupons } = store.state;
  return {
    rewards: store.rewards,
    products: [...products.values()], carts: [...carts.values()], orders: [...orders.values()],
    checkoutKeys: [...checkoutKeys], coupons: [...coupons.values()],
  };
}

function restore(value: Snapshot): InMemoryStore {
  const store = new InMemoryStore(value.products, value.rewards);
  store.state = {
    products: new Map(value.products.map((product) => [product.id, product])),
    carts: new Map(value.carts.map((cart) => [cart.id, cart])),
    orders: new Map(value.orders.map((order) => [order.id, order])),
    checkoutKeys: new Map(value.checkoutKeys),
    coupons: new Map(value.coupons.map((coupon) => [coupon.code, coupon])),
  };
  return store;
}

export class PostgresStoreAccess implements StoreAccess {
  private readonly pool: Pool;
  private ready?: Promise<void>;

  constructor(
    connectionString: string,
    private readonly seed: InMemoryStore,
    private readonly namespace = 'ecommerce',
  ) {
    this.pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });
    this.pool.on('error', () => console.error('PostgreSQL idle connection failed'));
    if (process.env.VERCEL) attachDatabasePool(this.pool);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  private async initialize(): Promise<void> {
    await this.transaction(async (client) => {
      // Serialize first-time schema creation across cold starts, including different namespaces.
      await client.query('SELECT pg_advisory_xact_lock(739204183)');
      await client.query(`CREATE TABLE IF NOT EXISTS ecommerce_state (
        namespace text PRIMARY KEY,
        snapshot jsonb NOT NULL
      )`);
      await client.query(
        'INSERT INTO ecommerce_state (namespace, snapshot) VALUES ($1, $2::jsonb) ON CONFLICT (namespace) DO NOTHING',
        [this.namespace, JSON.stringify(snapshot(this.seed))],
      );
    });
  }

  private async ensureReady(): Promise<void> {
    this.ready ??= this.initialize().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    await this.ready;
  }

  async read<T>(operation: (store: InMemoryStore) => T): Promise<T> {
    await this.ensureReady();
    const result = await this.pool.query<{ snapshot: Snapshot }>(
      'SELECT snapshot FROM ecommerce_state WHERE namespace = $1', [this.namespace],
    );
    return operation(restore(result.rows[0].snapshot));
  }

  async write<T>(operation: (store: InMemoryStore) => T | Promise<T>): Promise<T> {
    await this.ensureReady();
    return this.transaction(async (client) => {
      const result = await client.query<{ snapshot: Snapshot }>(
        'SELECT snapshot FROM ecommerce_state WHERE namespace = $1 FOR UPDATE', [this.namespace],
      );
      const store = restore(result.rows[0].snapshot);
      const before = store.state;
      const response = await operation(store);
      // A matching checkout replay leaves the saved snapshot untouched.
      if (store.state !== before) {
        await client.query('UPDATE ecommerce_state SET snapshot = $2::jsonb WHERE namespace = $1',
          [this.namespace, JSON.stringify(snapshot(store))]);
      }
      return response;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
