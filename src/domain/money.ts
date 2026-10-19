import { DomainError } from './errors.js';
import type { Paise } from './types.js';
import {
  validateDiscountPercent,
  validatePaise,
  validateQuantity,
} from './validation.js';

const MAX_SAFE_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);

function toSafePaise(value: bigint): Paise {
  if (value < 0n || value > MAX_SAFE_AMOUNT) {
    throw new DomainError(
      'AMOUNT_OUT_OF_RANGE',
      'Calculated amount is outside the supported paise range',
    );
  }

  return Number(value);
}

export function rupeesToPaise(value: unknown): Paise {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value)
  ) {
    throw new DomainError(
      'INVALID_REQUEST',
      'Rupees must be a nonnegative decimal string with at most two fractional digits',
      { field: 'rupees' },
    );
  }

  const [rupees, fraction = ''] = value.split('.');
  return toSafePaise(BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, '0')));
}

export function paiseToRupees(value: Paise): string {
  const paise = BigInt(validatePaise(value));
  const rupees = paise / 100n;
  const fraction = (paise % 100n).toString().padStart(2, '0');
  return `${rupees}.${fraction}`;
}

export function calculateLineTotal(unitPricePaise: Paise, quantity: number): Paise {
  const price = validatePaise(unitPricePaise, 'unitPricePaise');
  const count = validateQuantity(quantity);
  return toSafePaise(BigInt(price) * BigInt(count));
}

export function sumPaise(amounts: readonly Paise[]): Paise {
  let total = 0n;
  for (const amount of amounts) {
    total += BigInt(validatePaise(amount));
  }
  return toSafePaise(total);
}

export function calculateDiscount(subtotalPaise: Paise, discountPercent: number): Paise {
  const subtotal = validatePaise(subtotalPaise, 'subtotalPaise');
  const percent = validateDiscountPercent(discountPercent);
  // Round once on the whole subtotal; adding 50 before division rounds ties up.
  return toSafePaise((BigInt(subtotal) * BigInt(percent) + 50n) / 100n);
}

export function calculateTotal(subtotalPaise: Paise, discountPaise: Paise): Paise {
  const subtotal = validatePaise(subtotalPaise, 'subtotalPaise');
  const discount = validatePaise(discountPaise, 'discountPaise');
  return toSafePaise(BigInt(subtotal) - BigInt(discount));
}
