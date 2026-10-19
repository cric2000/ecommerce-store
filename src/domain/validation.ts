import { DomainError } from './errors.js';
import type { Paise } from './types.js';

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
