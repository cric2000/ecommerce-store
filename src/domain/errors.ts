export type DomainErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_QUANTITY'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'PRODUCT_NOT_FOUND'
  | 'CART_NOT_FOUND'
  | 'CART_ITEM_NOT_FOUND'
  | 'CART_ALREADY_CHECKED_OUT'
  | 'EMPTY_CART'
  | 'ORDER_NOT_FOUND'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'NO_ELIGIBLE_MILESTONE'
  | 'INVALID_COUPON'
  | 'COUPON_ALREADY_REDEEMED'
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_JSON'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'ROUTE_NOT_FOUND'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
