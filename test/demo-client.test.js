import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, CheckoutAttempt, formatMoney, requestJSON, userMessage } from '../public/client.js';

afterEach(() => vi.unstubAllGlobals());

test.each([
  ['NO_ELIGIBLE_MILESTONE', 'No coupon is ready yet. Place more orders and try again.'],
  ['INSUFFICIENT_STOCK', 'There isn’t enough stock for that quantity. Please choose a smaller quantity.'],
  ['INVALID_COUPON', 'That coupon code isn’t valid. Check the code and try again.'],
])('shows an actionable message without exposing the backend code %s', (code, expected) => {
  expect(userMessage(new ApiError(409, { code, message: 'Backend implementation details' }))).toBe(expected);
});

test('unrecognized API failures and connection failures use friendly messages', () => {
  expect(userMessage(new ApiError(500, { code: 'INTERNAL_ERROR', message: 'Private server details' })))
    .toBe('The store is having trouble right now. Please try again shortly.');
  expect(userMessage(new ApiError(400, { code: 'INVALID_JSON', message: 'Parser details' })))
    .toBe('We couldn’t complete that action. Please check your details and try again.');
  expect(userMessage(new TypeError('Failed to fetch')))
    .toBe('We couldn’t reach the store. Please check your connection and try again.');
});

test('the API client sends JSON and exposes structured server failures', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { code: 'INSUFFICIENT_STOCK', message: 'Requested quantity exceeds available inventory' },
  }), { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  await expect(requestJSON('/carts/cart/items', { method: 'POST', body: { productId: 'product-5', quantity: 2 } }))
    .rejects.toThrow(expect.objectContaining({ status: 409, code: 'INSUFFICIENT_STOCK' }));
  expect(fetch).toHaveBeenCalledWith('/carts/cart/items', expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{"productId":"product-5","quantity":2}',
  }));
});

test.each([
  new TypeError('Response lost after commit'),
  new ApiError(500, { code: 'INTERNAL_ERROR', message: 'Unexpected server error' }),
])('uncertain checkout retains the original key, cart, and coupon for retry: %s', async (error) => {
  const request = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ id: 'order-1' });
  const key = vi.fn().mockReturnValueOnce('first-key').mockReturnValueOnce('next-key');
  const checkout = new CheckoutAttempt(request, key);
  await expect(checkout.submit('original-cart', 'coupon-code')).rejects.toThrow(error);
  expect(checkout.pending).toEqual({ cartId: 'original-cart', body: { couponCode: 'coupon-code' }, key: 'first-key' });
  expect(await checkout.submit('changed-cart', 'changed-code')).toEqual({ id: 'order-1' });
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  expect(checkout.pending).toBeNull();
  expect(key).toHaveBeenCalledTimes(1);
  await checkout.submit('next-cart', '');
  expect(request).toHaveBeenLastCalledWith('/carts/next-cart/checkout', {
    method: 'POST', body: {}, key: 'next-key',
  });
});

test('a definitive client error releases the checkout attempt so the cart or coupon can be corrected', async () => {
  const request = vi.fn()
    .mockRejectedValueOnce(new ApiError(409, { code: 'INVALID_COUPON', message: 'Coupon was not found' }))
    .mockResolvedValue({ id: 'order-1' });
  const checkout = new CheckoutAttempt(request, vi.fn().mockReturnValueOnce('failed-key').mockReturnValueOnce('fixed-key'));
  await expect(checkout.submit('cart', 'bad-code')).rejects.toThrow(expect.objectContaining({ code: 'INVALID_COUPON' }));
  expect(checkout.pending).toBeNull();
  await checkout.submit('cart', '');
  expect(request).toHaveBeenLastCalledWith('/carts/cart/checkout', { method: 'POST', body: {}, key: 'fixed-key' });
});

test.each([
  [0, '₹0.00'], [105, '₹1.05'], [12500, '₹125.00'],
  [Number.MAX_SAFE_INTEGER, '₹9,00,71,99,25,47,409.91'],
])('formats %i paise without dropping precision', (paise, expected) => {
  expect(formatMoney(paise)).toBe(expected);
});
