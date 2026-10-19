import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { calculateDiscount, calculateLineTotal, calculateTotal, sumPaise } from '../domain/money.js';
import type { Order, OrderItem } from '../domain/types.js';
import { validateCouponCode, validateIdempotencyKey, validateObject, validateQuantity } from '../domain/validation.js';
import type { InMemoryStore } from '../store/memory.js';

export class OrderService {
  constructor(private readonly store: InMemoryStore) {}

  async checkout(cartId: string, input: unknown, keyInput: unknown): Promise<Order> {
    const body = validateObject(input, ['couponCode']);
    const couponCode = Object.hasOwn(body, 'couponCode') ? validateCouponCode(body.couponCode) : null;
    const key = validateIdempotencyKey(keyInput);
    return this.store.mutex.runExclusive(() => this.placeOrder(cartId, couponCode, key));
  }

  private placeOrder(cartId: string, couponCode: string | null, key: string): Order {
    const state = this.store.state;
    const previous = state.checkoutKeys.get(key);
    if (previous) {
      if (previous.cartId !== cartId || previous.couponCode !== couponCode) {
        throw new DomainError('IDEMPOTENCY_KEY_CONFLICT', 'Key already belongs to a different checkout request');
      }
      return this.getOrder(previous.orderId);
    }
    const cart = state.carts.get(cartId);
    if (!cart) throw new DomainError('CART_NOT_FOUND', 'Cart was not found');
    if (cart.status !== 'active') {
      throw new DomainError('CART_ALREADY_CHECKED_OUT', 'Cart has already been checked out');
    }
    if (cart.items.length === 0) {
      throw new DomainError('EMPTY_CART', 'Cannot check out an empty cart');
    }

    const coupon = couponCode === null ? undefined : state.coupons.get(couponCode);
    if (couponCode !== null && !coupon) {
      throw new DomainError('INVALID_COUPON', 'Coupon was not found');
    }
    if (coupon?.status === 'redeemed') {
      throw new DomainError('COUPON_ALREADY_REDEEMED', 'Coupon has already been redeemed');
    }

    const products = new Map(state.products);
    const seenProducts = new Set<string>();
    const items: OrderItem[] = [...cart.items]
      .sort((left, right) => left.productId.localeCompare(right.productId))
      .map((item) => {
        const quantity = validateQuantity(item.quantity);
        if (seenProducts.has(item.productId)) {
          throw new DomainError('INVALID_REQUEST', 'Cart contains duplicate product entries', {
            productId: item.productId,
          });
        }
        seenProducts.add(item.productId);

        const product = state.products.get(item.productId);
        if (!product) {
          throw new DomainError('PRODUCT_NOT_FOUND', 'Product was not found', {
            productId: item.productId,
          });
        }
        if (quantity > product.availableInventory) {
          throw new DomainError('INSUFFICIENT_STOCK', 'Requested quantity exceeds available inventory', {
            productId: product.id,
            requestedQuantity: quantity,
            availableInventory: product.availableInventory,
          });
        }

        const lineTotalPaise = calculateLineTotal(product.unitPricePaise, quantity);
        products.set(product.id, {
          ...product,
          availableInventory: product.availableInventory - quantity,
        });
        return {
          productId: product.id,
          name: product.name,
          quantity,
          unitPricePaise: product.unitPricePaise,
          lineTotalPaise,
        };
      });

    const subtotalPaise = sumPaise(items.map((item) => item.lineTotalPaise));
    const discountPaise = coupon ? calculateDiscount(subtotalPaise, coupon.discountPercent) : 0;
    const order: Order = {
      id: randomUUID(),
      cartId: cart.id,
      status: 'placed',
      createdAt: new Date().toISOString(),
      currency: 'INR',
      items,
      subtotalPaise,
      coupon: coupon ? {
        code: coupon.code, milestone: coupon.milestone, discountPercent: coupon.discountPercent,
      } : null,
      discountPaise,
      totalPaise: calculateTotal(subtotalPaise, discountPaise),
    };
    const orders = new Map(state.orders);
    orders.set(order.id, order);
    const carts = new Map(state.carts);
    carts.set(cart.id, { ...cart, status: 'checked_out', orderId: order.id });
    const response = structuredClone(order);
    const checkoutKeys = new Map(state.checkoutKeys);
    checkoutKeys.set(key, { cartId, couponCode, orderId: order.id });
    const coupons = new Map(state.coupons);
    if (coupon) {
      coupons.set(coupon.code, { ...coupon, status: 'redeemed', redeemedOrderId: order.id });
    }

    // Nothing touches live records until all validation and response preparation succeed.
    this.store.state = { ...state, products, carts, orders, checkoutKeys, coupons };
    return response;
  }

  getOrder(orderId: string): Order {
    const order = this.store.state.orders.get(orderId);
    if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Order was not found');
    return structuredClone(order);
  }
}
