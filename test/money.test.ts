import { describe, expect, test } from 'vitest';
import {
  calculateDiscount,
  calculateLineTotal,
  calculateTotal,
  paiseToRupees,
  rupeesToPaise,
  sumPaise,
} from '../src/domain/money.js';

describe('rupee and paise conversion', () => {
  test.each([
    ['0', 0], ['0.01', 1], ['0.1', 10], ['12', 1200],
    ['12.3', 1230], ['12.34', 1234], ['001.20', 120],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('converts %s rupees to exactly %i paise', (rupees, paise) => {
    expect(rupeesToPaise(rupees)).toBe(paise);
  });

  test.each([
    '', ' ', ' 1.00', '1.00 ', '1\n', '-1', '-0.01', '+1', '.50',
    '1.', '1.001', '1e2', 'NaN', 'Infinity', '1,000', 1.23, null, undefined,
  ])('rejects invalid decimal input %j', (rupees) => {
    expect(() => rupeesToPaise(rupees)).toThrowError(expect.objectContaining({
      code: 'INVALID_REQUEST',
    }));
  });

  test('rejects a decimal amount one paise above the supported maximum', () => {
    expect(() => rupeesToPaise('90071992547409.92')).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
  });

  test.each([
    [0, '0.00'], [1, '0.01'], [10, '0.10'], [1234, '12.34'],
    [Number.MAX_SAFE_INTEGER, '90071992547409.91'],
  ])('formats %i paise as %s rupees without losing precision', (paise, rupees) => {
    expect(paiseToRupees(paise)).toBe(rupees);
    expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise);
  });
});

describe('line totals and sums', () => {
  test('calculates exact totals and handles zero prices and empty sums', () => {
    const firstLine = calculateLineTotal(rupeesToPaise('0.10'), 3);
    const secondLine = calculateLineTotal(rupeesToPaise('0.20'), 1);
    expect(firstLine).toBe(30);
    expect(sumPaise([firstLine, secondLine])).toBe(50);
    expect(calculateLineTotal(0, 5)).toBe(0);
    expect(sumPaise([])).toBe(0);
  });

  test('accepts exact safe-integer boundaries and rejects multiplication/sum overflow', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(calculateLineTotal(maximum, 1)).toBe(maximum);
    expect(sumPaise([maximum - 1, 1])).toBe(maximum);
    expect(() => calculateLineTotal(maximum, 2)).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
    expect(() => sumPaise([maximum, 1])).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
  });

  test('rejects invalid inputs before arithmetic', () => {
    expect(() => calculateLineTotal(100, 0)).toThrowError(expect.objectContaining({
      code: 'INVALID_QUANTITY',
    }));
    expect(() => calculateLineTotal(-1, 1)).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
    expect(() => sumPaise([10, -1])).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
  });
});

describe('percentage discounts and final totals', () => {
  test.each([
    [104, 10, 10], [105, 10, 11], [106, 10, 11],
    [1, 49, 0], [1, 50, 1], [1, 100, 1],
    [0, 10, 0], [12345, 100, 12345],
    [Number.MAX_SAFE_INTEGER, 99, 8917127262193581],
    [Number.MAX_SAFE_INTEGER, 100, Number.MAX_SAFE_INTEGER],
  ])('rounds %i paise at %i percent to %i paise', (subtotal, percent, expected) => {
    const discount = calculateDiscount(subtotal, percent);
    expect(discount).toBe(expected);
    const total = calculateTotal(subtotal, discount);
    expect(total).toBe(subtotal - expected);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  test('rounds once on the combined subtotal rather than each line', () => {
    const subtotal = sumPaise([5, 5]);
    expect(calculateDiscount(subtotal, 10)).toBe(1);
    expect(calculateTotal(subtotal, calculateDiscount(subtotal, 10))).toBe(9);
  });

  test('rejects unsupported percentages and negative totals instead of clamping', () => {
    expect(() => calculateDiscount(100, 101)).toThrowError(expect.objectContaining({
      code: 'INVALID_REQUEST',
    }));
    expect(() => calculateDiscount(-1, 10)).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
    expect(() => calculateTotal(100, 101)).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
    expect(() => calculateTotal(100, -1)).toThrowError(expect.objectContaining({
      code: 'AMOUNT_OUT_OF_RANGE',
    }));
  });
});
