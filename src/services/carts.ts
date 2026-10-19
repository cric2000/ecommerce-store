import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { calculateLineTotal, sumPaise } from '../domain/money.js';
import type { Cart, CartView, Product } from '../domain/types.js';
import {
  validateObject,
  validateProductId,
  validateQuantity,
} from '../domain/validation.js';
import type { InMemoryStore, StoreState } from '../store/memory.js';

export class CartService {
  constructor(private readonly store: InMemoryStore) {}

  async createCart(input: unknown): Promise<CartView> {
    validateObject(input, []);
    const cart: Cart = { id: randomUUID(), status: 'active', orderId: null, items: [] };
    return this.store.mutex.runExclusive(() => this.saveCart(this.store.state, cart));
  }

  getCart(cartId: string): CartView {
    const state = this.store.state;
    return this.toView(this.findCart(state, cartId), state);
  }

  async addItem(cartId: string, input: unknown): Promise<CartView> {
    const body = validateObject(input, ['productId', 'quantity']);
    const productId = validateProductId(body.productId);
    const quantity = validateQuantity(body.quantity);
    return this.store.mutex.runExclusive(() => {
      const state = this.store.state;
      const cart = this.activeCart(state, cartId);
      const product = this.findProduct(state, productId);
      const existing = cart.items.find((item) => item.productId === productId);
      const nextQuantity = validateQuantity((existing?.quantity ?? 0) + quantity);
      this.checkStock(product, nextQuantity);

      const items = [
        ...cart.items.filter((item) => item.productId !== productId),
        { productId, quantity: nextQuantity },
      ];
      return this.saveCart(state, { ...cart, items });
    });
  }

  async updateItem(cartId: string, productId: string, input: unknown): Promise<CartView> {
    const body = validateObject(input, ['quantity']);
    const quantity = validateQuantity(body.quantity);
    return this.store.mutex.runExclusive(() => {
      const state = this.store.state;
      const cart = this.activeCart(state, cartId);
      const product = this.findProduct(state, productId);
      this.requireItem(cart, productId);
      this.checkStock(product, quantity);

      const items = cart.items.map((item) => (
        item.productId === productId ? { productId, quantity } : item
      ));
      return this.saveCart(state, { ...cart, items });
    });
  }

  async removeItem(cartId: string, productId: string): Promise<CartView> {
    return this.store.mutex.runExclusive(() => {
      const state = this.store.state;
      const cart = this.activeCart(state, cartId);
      this.requireItem(cart, productId);
      const items = cart.items.filter((item) => item.productId !== productId);
      return this.saveCart(state, { ...cart, items });
    });
  }

  private findCart(state: StoreState, cartId: string): Cart {
    const cart = state.carts.get(cartId);
    if (!cart) throw new DomainError('CART_NOT_FOUND', 'Cart was not found');
    return cart;
  }

  private activeCart(state: StoreState, cartId: string): Cart {
    const cart = this.findCart(state, cartId);
    if (cart.status !== 'active') {
      throw new DomainError('CART_ALREADY_CHECKED_OUT', 'Cart has already been checked out');
    }
    return cart;
  }

  private findProduct(state: StoreState, productId: string): Product {
    const product = state.products.get(productId);
    if (!product) {
      throw new DomainError('PRODUCT_NOT_FOUND', 'Product was not found', { productId });
    }
    return product;
  }

  private requireItem(cart: Cart, productId: string): void {
    if (!cart.items.some((item) => item.productId === productId)) {
      throw new DomainError('CART_ITEM_NOT_FOUND', 'Cart does not contain this product', {
        productId,
      });
    }
  }

  private checkStock(product: Product, quantity: number): void {
    if (quantity > product.availableInventory) {
      throw new DomainError('INSUFFICIENT_STOCK', 'Requested quantity exceeds available inventory', {
        productId: product.id,
        requestedQuantity: quantity,
        availableInventory: product.availableInventory,
      });
    }
  }

  private toView(cart: Cart, state: StoreState): CartView {
    const items = [...cart.items]
      .sort((left, right) => left.productId.localeCompare(right.productId))
      .map((item) => {
        const product = this.findProduct(state, item.productId);
        return {
          ...item,
          name: product.name,
          unitPricePaise: product.unitPricePaise,
          lineTotalPaise: calculateLineTotal(product.unitPricePaise, item.quantity),
          availableInventory: product.availableInventory,
          isAvailable: product.availableInventory >= item.quantity,
        };
      });

    return {
      ...cart,
      currency: 'INR',
      items,
      subtotalPaise: sumPaise(items.map((item) => item.lineTotalPaise)),
    };
  }

  private saveCart(state: StoreState, cart: Cart): CartView {
    // Build the response before publishing, so a pricing/validation error saves nothing.
    const view = this.toView(cart, state);
    const carts = new Map(state.carts);
    carts.set(cart.id, cart);
    this.store.state = { ...state, carts };
    return view;
  }
}
