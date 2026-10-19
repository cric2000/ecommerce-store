import { expect, test } from 'vitest';
import { DEFAULT_REWARDS, readRewardConfig } from '../src/config.js';
import { InMemoryStore } from '../src/store/memory.js';

test('loads defaults or explicit decimal reward configuration', () => {
  expect(readRewardConfig({})).toEqual(DEFAULT_REWARDS);
  expect(readRewardConfig({ COUPON_INTERVAL: '2', DISCOUNT_PERCENT: '25' }))
    .toEqual({ couponInterval: 2, discountPercent: 25 });
  expect(readRewardConfig({ COUPON_INTERVAL: String(Number.MAX_SAFE_INTEGER), DISCOUNT_PERCENT: '100' }))
    .toEqual({ couponInterval: Number.MAX_SAFE_INTEGER, discountPercent: 100 });
});

test.each([
  ['COUPON_INTERVAL', '0'], ['COUPON_INTERVAL', '-1'], ['COUPON_INTERVAL', '1.5'],
  ['COUPON_INTERVAL', '1e2'], ['COUPON_INTERVAL', ' 5'], ['COUPON_INTERVAL', '5\n'],
  ['COUPON_INTERVAL', ''], ['COUPON_INTERVAL', '9007199254740992'],
  ['DISCOUNT_PERCENT', '0'], ['DISCOUNT_PERCENT', '101'], ['DISCOUNT_PERCENT', '10.5'],
  ['DISCOUNT_PERCENT', 'NaN'], ['DISCOUNT_PERCENT', 'Infinity'], ['DISCOUNT_PERCENT', ''],
])('rejects invalid startup configuration %s=%j', (name, value) => {
  expect(() => readRewardConfig({ [name]: value })).toThrow(name);
});

test('the store validates and snapshots fixed reward settings', () => {
  const settings = { couponInterval: 2, discountPercent: 10 };
  const store = new InMemoryStore(undefined, settings);
  settings.couponInterval = 100;
  settings.discountPercent = 90;
  expect(store.rewards).toEqual({ couponInterval: 2, discountPercent: 10 });
  expect(Object.isFrozen(store.rewards)).toBe(true);
  expect(() => new InMemoryStore(undefined, { couponInterval: 0, discountPercent: 10 }))
    .toThrow('COUPON_INTERVAL');
});
