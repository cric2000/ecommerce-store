// Paise is a number alias; money helpers enforce its integer and range rules.
export type Paise = number;
export type Currency = 'INR';

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly unitPricePaise: Paise;
  readonly availableInventory: number;
}

export interface CartItem {
  readonly productId: string;
  readonly quantity: number;
}

type CartState =
  | { readonly status: 'active'; readonly orderId: null }
  | { readonly status: 'checked_out'; readonly orderId: string };

export type Cart = CartState & {
  readonly id: string;
  readonly items: readonly CartItem[];
};

export interface CartItemView extends CartItem {
  readonly name: string;
  readonly unitPricePaise: Paise;
  readonly lineTotalPaise: Paise;
  readonly availableInventory: number;
  readonly isAvailable: boolean;
}

export type CartView = CartState & {
  readonly id: string;
  readonly currency: Currency;
  readonly items: readonly CartItemView[];
  readonly subtotalPaise: Paise;
};

export interface AppliedCoupon {
  readonly code: string;
  readonly milestone: number;
  readonly discountPercent: number;
}

export type Coupon = AppliedCoupon &
  (
    | { readonly status: 'available'; readonly redeemedOrderId: null }
    | { readonly status: 'redeemed'; readonly redeemedOrderId: string }
  );

export interface OrderItem extends CartItem {
  readonly name: string;
  readonly unitPricePaise: Paise;
  readonly lineTotalPaise: Paise;
}

export interface Order {
  readonly id: string;
  readonly cartId: string;
  readonly status: 'placed';
  readonly createdAt: string;
  readonly currency: Currency;
  readonly items: readonly OrderItem[];
  readonly subtotalPaise: Paise;
  readonly coupon: AppliedCoupon | null;
  readonly discountPaise: Paise;
  readonly totalPaise: Paise;
}

export interface ProductPurchaseQuantity {
  readonly productId: string;
  readonly quantity: number;
}

export interface AdminReport {
  readonly currency: Currency;
  readonly purchasedQuantityByProduct: readonly ProductPurchaseQuantity[];
  readonly grossRevenuePaise: Paise;
  readonly totalDiscountsPaise: Paise;
  readonly netRevenuePaise: Paise;
  readonly coupons: {
    readonly generated: number;
    readonly available: number;
    readonly redeemed: number;
  };
  readonly totalOrders: number;
}
