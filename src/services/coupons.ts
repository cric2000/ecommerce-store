import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import type { Coupon } from '../domain/types.js';
import { validateObject } from '../domain/validation.js';
import type { InMemoryStore } from '../store/memory.js';

export class CouponService {
  constructor(private readonly store: InMemoryStore) {}

  async generate(input: unknown): Promise<Coupon> {
    validateObject(input, []);
    return this.store.mutex.runExclusive(() => {
      const state = this.store.state;
      const rewarded = new Set([...state.coupons.values()].map((coupon) => coupon.milestone));
      const interval = this.store.rewards.couponInterval;
      let milestone = interval;
      while (milestone <= state.orders.size && rewarded.has(milestone)) milestone += interval;
      if (milestone > state.orders.size) {
        throw new DomainError('NO_ELIGIBLE_MILESTONE', 'No unrewarded order milestone is eligible');
      }

      const coupon: Coupon = {
        code: randomUUID(),
        milestone,
        discountPercent: this.store.rewards.discountPercent,
        status: 'available',
        redeemedOrderId: null,
      };
      const coupons = new Map(state.coupons);
      coupons.set(coupon.code, coupon);
      const response = structuredClone(coupon);
      this.store.state = { ...state, coupons };
      return response;
    });
  }
}
