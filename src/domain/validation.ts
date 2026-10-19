import { DomainError } from './errors.js';
import type { Paise } from './types.js';

export function validateIdempotencyKey(value: unknown): string {
  if (
    typeof value !== 'string' || value.length < 1 || value.length > 128 ||
    /[^A-Za-z0-9._:-]/.test(value)
  ) {
    throw new DomainError(
      'INVALID_IDEMPOTENCY_KEY',
      'Checkout requires one Idempotency-Key of 1–128 letters, digits, dots, underscores, colons, or hyphens',
      { field: 'Idempotency-Key' },
    );
  }
  return value;
}

export function validateObject(
  value: unknown,
  allowedFields: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('INVALID_REQUEST', 'Body must be a JSON object');
  }

  for (const field of Object.keys(value)) {
    if (!allowedFields.includes(field)) {
      throw new DomainError('INVALID_REQUEST', 'Unknown body property', { field });
    }
  }

  return value as Record<string, unknown>;
}

export function validateProductId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError('INVALID_REQUEST', 'Product ID must be a nonblank string', {
      field: 'productId',
    });
  }

  return value;
}

export function validateQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError(
      'INVALID_QUANTITY',
      'Quantity must be a positive safe integer',
      { field: 'quantity' },
    );
  }

  return value;
}

export function validateDiscountPercent(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  ) {
    throw new DomainError(
      'INVALID_REQUEST',
      'Discount percent must be an integer between 1 and 100',
      { field: 'discountPercent' },
    );
  }

  return value;
}

export function validatePaise(value: unknown, field = 'amountPaise'): Paise {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainError(
      'AMOUNT_OUT_OF_RANGE',
      'Amount must be a nonnegative safe integer in paise',
      { field },
    );
  }

  return value;
}
