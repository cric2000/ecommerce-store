export interface RewardConfig {
  readonly couponInterval: number;
  readonly discountPercent: number;
}

export const DEFAULT_REWARDS: RewardConfig = Object.freeze({
  couponInterval: 5,
  discountPercent: 10,
});

export function validateRewardConfig(config: RewardConfig): RewardConfig {
  if (!Number.isSafeInteger(config.couponInterval) || config.couponInterval < 1) {
    throw new Error('COUPON_INTERVAL must be a positive safe integer');
  }
  if (!Number.isInteger(config.discountPercent) || config.discountPercent < 1 || config.discountPercent > 100) {
    throw new Error('DISCOUNT_PERCENT must be an integer between 1 and 100');
  }
  return Object.freeze({ ...config });
}

export function readRewardConfig(env: NodeJS.ProcessEnv = process.env): RewardConfig {
  function readInteger(name: string, fallback: number): number {
    const value = env[name];
    if (value === undefined) return fallback;
    if (value.length === 0 || /[^0-9]/.test(value)) {
      throw new Error(`${name} must contain only decimal digits`);
    }
    return Number(value);
  }
  return validateRewardConfig({
    couponInterval: readInteger('COUPON_INTERVAL', DEFAULT_REWARDS.couponInterval),
    discountPercent: readInteger('DISCOUNT_PERCENT', DEFAULT_REWARDS.discountPercent),
  });
}
