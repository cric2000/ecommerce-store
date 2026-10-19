import { describe, expect, test } from 'vitest';
import { DomainError } from '../src/domain/errors.js';
import {
  validateDiscountPercent,
  validatePaise,
  validateQuantity,
} from '../src/domain/validation.js';

describe('quantity validation', () => {
  test('accepts positive safe integers including the boundary', () => {
    expect(validateQuantity(1)).toBe(1);
    expect(validateQuantity(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test.each([
    0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity,
    '2', '', null, undefined, true, {}, [],
  ])('rejects invalid quantity %j without coercion', (quantity) => {
    expect(() => validateQuantity(quantity)).toThrowError(DomainError);
    expect(() => validateQuantity(quantity)).toThrowError(expect.objectContaining({
      code: 'INVALID_QUANTITY',
      details: { field: 'quantity' },
    }));
  });
});

describe('discount percent validation', () => {
  test('accepts the inclusive 1–100 percent range', () => {
    expect(validateDiscountPercent(1)).toBe(1);
    expect(validateDiscountPercent(100)).toBe(100);
  });

  test.each([0, -1, 101, 10.5, NaN, Infinity, '10', null, undefined])(
    'rejects invalid percent %j',
    (percent) => {
      expect(() => validateDiscountPercent(percent)).toThrowError(expect.objectContaining({
        code: 'INVALID_REQUEST',
        details: { field: 'discountPercent' },
      }));
    },
  );
});

describe('paise validation', () => {
  test('accepts zero and the largest safe integer amount', () => {
    expect(validatePaise(0)).toBe(0);
    expect(validatePaise(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '100', null])(
    'rejects unsafe or non-integer paise %j',
    (amount) => {
      expect(() => validatePaise(amount, 'subtotalPaise')).toThrowError(expect.objectContaining({
        code: 'AMOUNT_OUT_OF_RANGE',
        details: { field: 'subtotalPaise' },
      }));
    },
  );
});
