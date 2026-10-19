import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { calculateLineTotal, calculateTotal, sumPaise } from '../domain/money.js';
import type { Order, OrderItem } from '../domain/types.js';
import { validateObject, validateQuantity } from '../domain/validation.js';
import type { InMemoryStore } from '../store/memory.js';

export class OrderService {
  constructor(private readonly store: InMemoryStore) {}

  checkout(cartId: string, input: unknown): Order {
    validateObject(input, []);
    const state = this.store.state;
    const cart = state.carts.get(cartId);
    if (!cart) throw new DomainError('CART_NOT_FOUND', 'Cart was not found');
    if (cart.status !== 'active') {
      throw new DomainError('CART_ALREADY_CHECKED_OUT', 'Cart has already been checked out');
    }
    if (cart.items.length === 0) {
      throw new DomainError('EMPTY_CART', 'Cannot check out an empty cart');
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
    const order: Order = {
      id: randomUUID(),
      cartId: cart.id,
      status: 'placed',
      createdAt: new Date().toISOString(),
      currency: 'INR',
      items,
      subtotalPaise,
      coupon: null,
      discountPaise: 0,
      totalPaise: calculateTotal(subtotalPaise, 0),
    };
    const orders = new Map(state.orders);
    orders.set(order.id, order);
    const carts = new Map(state.carts);
    carts.set(cart.id, { ...cart, status: 'checked_out', orderId: order.id });
    const response = structuredClone(order);

    // Nothing touches live records until all validation and response preparation succeed.
    this.store.state = { ...state, products, carts, orders };
    return response;
  }

  getOrder(orderId: string): Order {
    const order = this.store.state.orders.get(orderId);
    if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Order was not found');
    return structuredClone(order);
  }
}
