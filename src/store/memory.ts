import type { Cart, Coupon, Order, Product } from '../domain/types.js';
import { DEFAULT_REWARDS, validateRewardConfig, type RewardConfig } from '../config.js';
import { seedProducts } from './seed.js';
import { Mutex } from './mutex.js';

export interface CheckoutRecord {
  readonly cartId: string;
  readonly couponCode: string | null;
  readonly orderId: string;
}

export interface StoreState {
  readonly products: ReadonlyMap<string, Product>;
  readonly carts: ReadonlyMap<string, Cart>;
  readonly orders: ReadonlyMap<string, Order>;
  readonly checkoutKeys: ReadonlyMap<string, CheckoutRecord>;
  readonly coupons: ReadonlyMap<string, Coupon>;
}

export class InMemoryStore {
  readonly mutex = new Mutex();
  readonly rewards: RewardConfig;
  state: StoreState;

  constructor(products: readonly Product[] = seedProducts, rewards: RewardConfig = DEFAULT_REWARDS) {
    this.rewards = validateRewardConfig(rewards);
    this.state = {
      products: new Map(products.map((product) => [product.id, { ...product }])),
      carts: new Map(),
      orders: new Map(),
      checkoutKeys: new Map(),
      coupons: new Map(),
    };
  }
}
