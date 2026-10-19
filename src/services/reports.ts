import { DomainError } from '../domain/errors.js';
import { sumPaise } from '../domain/money.js';
import type { AdminReport } from '../domain/types.js';
import type { InMemoryStore } from '../store/memory.js';

export class ReportService {
  constructor(private readonly store: InMemoryStore) {}

  getReport(): AdminReport {
    const state = this.store.state;
    const orders = [...state.orders.values()];
    const quantities = new Map<string, bigint>();
    for (const order of orders) {
      for (const item of order.items) {
        quantities.set(item.productId, (quantities.get(item.productId) ?? 0n) + BigInt(item.quantity));
      }
    }

    const purchasedQuantityByProduct = [...quantities]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([productId, quantity]) => {
        if (quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Purchased quantity exceeds the supported integer range', {
            productId,
          });
        }
        return { productId, quantity: Number(quantity) };
      });

    let available = 0;
    let redeemed = 0;
    for (const coupon of state.coupons.values()) {
      if (coupon.status === 'available') available++;
      else redeemed++;
    }

    return {
      currency: 'INR',
      purchasedQuantityByProduct,
      grossRevenuePaise: sumPaise(orders.map((order) => order.subtotalPaise)),
      totalDiscountsPaise: sumPaise(orders.map((order) => order.discountPaise)),
      netRevenuePaise: sumPaise(orders.map((order) => order.totalPaise)),
      coupons: { generated: state.coupons.size, available, redeemed },
      totalOrders: orders.length,
    };
  }
}
