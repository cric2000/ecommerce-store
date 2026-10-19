export class ApiError extends Error {
  constructor(status, error) {
    super(error.message);
    this.status = status;
    this.code = error.code;
  }
}

export function userMessage(error) {
  if (!(error instanceof ApiError)) {
    return 'We couldn’t reach the store. Please check your connection and try again.';
  }
  const messages = {
    NO_ELIGIBLE_MILESTONE: 'No coupon is ready yet. Place more orders and try again.',
    INSUFFICIENT_STOCK: 'There isn’t enough stock for that quantity. Please choose a smaller quantity.',
    INVALID_QUANTITY: 'Please enter a whole-number quantity of at least one.',
    INVALID_COUPON: 'That coupon code isn’t valid. Check the code and try again.',
    COUPON_ALREADY_REDEEMED: 'This coupon has already been used. Please try another code.',
    EMPTY_CART: 'Add something to your cart before placing an order.',
    CART_ALREADY_CHECKED_OUT: 'This cart has already been checked out. Start a new cart to keep shopping.',
    CART_NOT_FOUND: 'Your cart is no longer available. Please start a new cart.',
    CART_ITEM_NOT_FOUND: 'This item is no longer in your cart. Please refresh the store.',
    PRODUCT_NOT_FOUND: 'This product is no longer available. Please refresh the store.',
    ORDER_NOT_FOUND: 'We couldn’t find that order. Please refresh the store.',
    IDEMPOTENCY_KEY_CONFLICT: 'Please refresh the store to check your order before trying checkout again.',
    AMOUNT_OUT_OF_RANGE: 'That quantity or total is too large for the store to process.',
  };
  return messages[error.code] ?? (error.status >= 500
    ? 'The store is having trouble right now. Please try again shortly.'
    : 'We couldn’t complete that action. Please check your details and try again.');
}

export async function requestJSON(path, { method = 'GET', body, key } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key === undefined ? {} : { 'Idempotency-Key': key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok) throw new ApiError(response.status, value.error);
  return value;
}

export class CheckoutAttempt {
  pending = null;

  constructor(request = requestJSON, newKey = () => crypto.randomUUID()) {
    this.request = request;
    this.newKey = newKey;
  }

  async submit(cartId, couponCode = '') {
    // An uncertain result must be retried with the original key and request body.
    this.pending ??= {
      cartId,
      body: couponCode === '' ? {} : { couponCode },
      key: this.newKey(),
    };
    const attempt = this.pending;
    try {
      const order = await this.request(`/carts/${encodeURIComponent(attempt.cartId)}/checkout`, {
        method: 'POST', body: attempt.body, key: attempt.key,
      });
      this.pending = null;
      return order;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) this.pending = null;
      throw error;
    }
  }
}

export function formatMoney(paise) {
  const amount = BigInt(paise);
  return `₹${(amount / 100n).toLocaleString('en-IN')}.${(amount % 100n).toString().padStart(2, '0')}`;
}
