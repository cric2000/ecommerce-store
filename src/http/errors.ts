import type { ErrorRequestHandler } from 'express';
import { DomainError, type DomainErrorCode } from '../domain/errors.js';

const statusByCode: Record<DomainErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_QUANTITY: 400,
  AMOUNT_OUT_OF_RANGE: 422,
  PRODUCT_NOT_FOUND: 404,
  CART_NOT_FOUND: 404,
  CART_ITEM_NOT_FOUND: 404,
  CART_ALREADY_CHECKED_OUT: 409,
  EMPTY_CART: 409,
  ORDER_NOT_FOUND: 404,
  INVALID_IDEMPOTENCY_KEY: 400,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  NO_ELIGIBLE_MILESTONE: 409,
  INVALID_COUPON: 409,
  COUPON_ALREADY_REDEEMED: 409,
  INSUFFICIENT_STOCK: 409,
  INVALID_JSON: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  ROUTE_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  let failure: DomainError;
  if (error instanceof DomainError) {
    failure = error;
  } else if (error instanceof Error && 'type' in error && error.type === 'entity.parse.failed') {
    failure = new DomainError('INVALID_JSON', 'Request body is not valid JSON');
  } else if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
    failure = new DomainError('PAYLOAD_TOO_LARGE', 'JSON body exceeds the 100 KiB limit');
  } else {
    failure = new DomainError('INTERNAL_ERROR', 'Unexpected server error');
  }

  response.status(statusByCode[failure.code]).json({
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.details === undefined ? {} : { details: failure.details }),
    },
  });
};
