import type { OpenAPIV3 } from 'openapi-types';

const ref = (name: string): OpenAPIV3.ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const integer = (minimum = 0): OpenAPIV3.SchemaObject => ({
  type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER,
});
const text: OpenAPIV3.SchemaObject = { type: 'string', minLength: 1 };
const currency: OpenAPIV3.SchemaObject = { type: 'string', enum: ['INR'] };
const object = (
  properties: Record<string, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>,
  required = Object.keys(properties),
): OpenAPIV3.SchemaObject => ({
  type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false,
});
const array = (items: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): OpenAPIV3.SchemaObject => ({
  type: 'array', items,
});
const parameter = (name: string, example: string): OpenAPIV3.ParameterObject => ({
  name, in: 'path', required: true, description: 'Use the ID returned by the API.', schema: text, example,
});
const cartId = parameter('cartId', 'paste-cart-id');
const productId = parameter('productId', 'product-1');
const body = (
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  examples: Record<string, OpenAPIV3.ExampleObject>,
): OpenAPIV3.RequestBodyObject => ({
  required: true, content: { 'application/json': { schema, examples } },
});
const emptyBody = body(ref('EmptyObject'), { empty: { summary: 'Empty JSON object (required)', value: {} } });
const success = (
  description: string, schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  example: unknown, location?: string,
): OpenAPIV3.ResponseObject => ({
  description,
  content: { 'application/json': { schema, example } },
  ...(location ? { headers: { Location: { description: location, schema: { type: 'string' } } } } : {}),
});
const failures = (descriptions: Record<string, string>, hasBody = false): OpenAPIV3.ResponsesObject => {
  const errors = {
    ...(hasBody ? {
      '413': 'PAYLOAD_TOO_LARGE: JSON body exceeds 100 KiB.',
      '415': 'UNSUPPORTED_MEDIA_TYPE: Use application/json with a supported charset/encoding.',
    } : {}),
    ...descriptions,
    '500': 'INTERNAL_ERROR: Unexpected server failure; internal details are hidden.',
  };
  return Object.fromEntries(Object.entries(errors).map(([status, description]) => [status, {
    description, content: { 'application/json': { schema: ref('Error') } },
  }]));
};

const productExample = { id: 'product-1', name: 'Notebook', unitPricePaise: 12500, availableInventory: 50 };
const cartItemExample = {
  productId: 'product-1', name: 'Notebook', quantity: 1, unitPricePaise: 12500,
  lineTotalPaise: 12500, availableInventory: 50, isAvailable: true,
};
const cartExample = {
  id: 'cart-example', status: 'active', orderId: null, currency: 'INR',
  items: [cartItemExample], subtotalPaise: 12500,
};
const couponExample = {
  code: 'paste-generated-code', milestone: 5, discountPercent: 10,
  status: 'available', redeemedOrderId: null,
};
const orderExample = {
  id: 'order-example', cartId: 'cart-example', status: 'placed',
  createdAt: '2026-10-19T09:00:00.000Z', currency: 'INR',
  items: [{ productId: 'product-1', name: 'Notebook', quantity: 1, unitPricePaise: 12500, lineTotalPaise: 12500 }],
  subtotalPaise: 12500, coupon: null, discountPaise: 0, totalPaise: 12500,
};
const appliedCoupon = object({ code: text, milestone: integer(1), discountPercent: { type: 'integer', minimum: 1, maximum: 100 } });
const invalidBody = 'INVALID_JSON or INVALID_REQUEST: Send a JSON object with only the documented properties. Undecodable URLs/bodies also return INVALID_REQUEST.';

export const openapi: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'Checkout and rewards API', version: '0.1.0',
    description: [
      'Browse all 11 API operations and use **Try it out** to send requests to this running server.',
      '**Requests change the same in-memory store used by the browser demo.** Restarting resets all data. No real payments occur.',
      'Start with GET /products, POST /carts (send `{}`), add an item, then checkout using the returned cart ID and an Idempotency-Key.',
      'All money is in integer **INR paise** (100 paise = ₹1). Discounts use half-up rounding once on the subtotal.',
      'No authentication is implemented, including for administrative operations. IDs and coupon codes are case-sensitive. Unknown JSON properties are rejected; request bodies are limited to 100 KiB.',
      'The repository’s API.md documents detailed concurrency and retry rules.',
    ].join('\n\n'),
  },
  servers: [{ url: '/', description: 'This running server (same host and port)' }],
  tags: [
    { name: 'Health', description: 'Process liveness.' },
    { name: 'Products', description: 'Current seeded catalog and inventory.' },
    { name: 'Carts', description: 'Cart lifecycle; prices and availability are current and stock is not reserved.' },
    { name: 'Orders', description: 'Checkout and immutable purchase receipts.' },
    { name: 'Administration', description: 'Administrative operations by convention only; no authentication.' },
  ],
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth', tags: ['Health'], summary: 'Check server health',
        responses: { '200': success('Process can answer HTTP.', object({ status: { type: 'string', enum: ['ok'] } }), { status: 'ok' }), ...failures({}) },
      },
    },
    '/products': {
      get: {
        operationId: 'listProducts', tags: ['Products'], summary: 'List products and current stock',
        responses: { '200': success('Current catalog; no inventory is reserved.', ref('Catalog'), { currency: 'INR', products: [productExample] }), ...failures({}) },
      },
    },
    '/carts': {
      post: {
        operationId: 'createCart', tags: ['Carts'], summary: 'Create an empty cart',
        description: 'Send `{}`. Each successful call creates a new cart; this operation is not idempotent.',
        requestBody: emptyBody,
        responses: {
          '201': success('Cart created.', ref('Cart'), { ...cartExample, items: [], subtotalPaise: 0 }, '/carts/<returned-id>'),
          ...failures({ '400': invalidBody }, true),
        },
      },
    },
    '/carts/{cartId}': {
      get: {
        operationId: 'getCart', tags: ['Carts'], summary: 'Read a cart and current totals', parameters: [cartId],
        description: 'Active and checked-out carts are readable. Prices/stock are current; use the saved order for the purchase snapshot.',
        responses: {
          '200': success('Cart with current prices and stock availability.', ref('Cart'), cartExample),
          ...failures({
            '400': 'INVALID_REQUEST: Undecodable URL.',
            '404': 'CART_NOT_FOUND or PRODUCT_NOT_FOUND.',
            '422': 'AMOUNT_OUT_OF_RANGE: Current cart totals exceed the safe integer range.',
          }),
        },
      },
    },
    '/carts/{cartId}/items': {
      post: {
        operationId: 'addCartItem', tags: ['Carts'], summary: 'Add an item or increment its quantity', parameters: [cartId],
        requestBody: body(ref('AddItem'), { notebook: { value: { productId: 'product-1', quantity: 1 } } }),
        responses: {
          '200': success('Updated cart. Current stock is checked but not reserved.', ref('Cart'), cartExample),
          ...failures({
            '400': `${invalidBody} INVALID_QUANTITY: Quantity or resulting quantity must be a positive safe integer.`,
            '404': 'CART_NOT_FOUND or PRODUCT_NOT_FOUND.',
            '409': 'CART_ALREADY_CHECKED_OUT or INSUFFICIENT_STOCK.',
            '422': 'AMOUNT_OUT_OF_RANGE: Cart totals exceed the safe integer range.',
          }, true),
        },
      },
    },
    '/carts/{cartId}/items/{productId}': {
      patch: {
        operationId: 'updateCartItem', tags: ['Carts'], summary: 'Set an existing item quantity', parameters: [cartId, productId],
        description: 'Quantity is absolute, not an increment. Use DELETE to remove an item; zero is invalid.',
        requestBody: body(ref('UpdateItem'), { quantity: { value: { quantity: 2 } } }),
        responses: {
          '200': success('Updated cart.', ref('Cart'), { ...cartExample, items: [{ ...cartItemExample, quantity: 2, lineTotalPaise: 25000 }], subtotalPaise: 25000 }),
          ...failures({
            '400': `${invalidBody} INVALID_QUANTITY: Quantity must be a positive safe integer.`,
            '404': 'CART_NOT_FOUND, PRODUCT_NOT_FOUND, or CART_ITEM_NOT_FOUND.',
            '409': 'CART_ALREADY_CHECKED_OUT or INSUFFICIENT_STOCK.',
            '422': 'AMOUNT_OUT_OF_RANGE: Cart totals exceed the safe integer range.',
          }, true),
        },
      },
      delete: {
        operationId: 'removeCartItem', tags: ['Carts'], summary: 'Remove an existing cart item', parameters: [cartId, productId],
        description: 'No request body. Repeating removal returns CART_ITEM_NOT_FOUND.',
        responses: {
          '200': success('Updated cart.', ref('Cart'), { ...cartExample, items: [], subtotalPaise: 0 }),
          ...failures({
            '400': 'INVALID_REQUEST: Undecodable URL.',
            '404': 'CART_NOT_FOUND or CART_ITEM_NOT_FOUND; PRODUCT_NOT_FOUND if another remaining line has no catalog product.',
            '409': 'CART_ALREADY_CHECKED_OUT.',
            '422': 'AMOUNT_OUT_OF_RANGE: Remaining cart totals exceed the safe integer range.',
          }),
        },
      },
    },
    '/carts/{cartId}/checkout': {
      post: {
        operationId: 'checkout', tags: ['Orders'], summary: 'Place an order with an optional coupon',
        description: [
          'Send `{}` without a coupon, or `{ "couponCode": "..." }` with one generated code.',
          'Use a new Idempotency-Key for each purchase. After an uncertain result, retry with the **same key, cart ID, and coupon body**. A matching successful retry returns the original 201/order/Location without deducting stock or redeeming the coupon again. Reusing a successful key with a different cart/coupon returns 409.',
          'Failed attempts leave the key unbound. Cart contents are not part of the key identity; checkout uses their current state until the first success. A cart can succeed only once. Inventory, cart closure, order, key, and coupon redemption commit together.',
          'Coupon codes match exactly without trimming/case conversion. No stacking, ownership, or expiry. A 100% discount produces a valid zero-total order.',
        ].join('\n\n'),
        parameters: [cartId, {
          name: 'Idempotency-Key', in: 'header', required: true,
          description: 'Exactly one header. Choose a unique value per purchase; preserve it for retries.',
          schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
          example: 'purchase-001',
        }],
        requestBody: body(ref('Checkout'), {
          withoutCoupon: { summary: 'Without coupon', value: {} },
          withCoupon: { summary: 'With a generated coupon', value: { couponCode: 'paste-generated-code' } },
        }),
        responses: {
          '201': success('Order placed, or original order replayed for a matching successful key.', ref('Order'), orderExample, '/orders/<returned-id>'),
          ...failures({
            '400': `${invalidBody} INVALID_QUANTITY or INVALID_IDEMPOTENCY_KEY. Request validation precedes key lookup.`,
            '404': 'CART_NOT_FOUND or PRODUCT_NOT_FOUND.',
            '409': 'EMPTY_CART, CART_ALREADY_CHECKED_OUT, INSUFFICIENT_STOCK, INVALID_COUPON, COUPON_ALREADY_REDEEMED, or IDEMPOTENCY_KEY_CONFLICT. Failed checkout preserves stock and any available coupon.',
            '422': 'AMOUNT_OUT_OF_RANGE: Purchase amounts exceed the safe integer range.',
          }, true),
        },
      },
    },
    '/orders/{orderId}': {
      get: {
        operationId: 'getOrder', tags: ['Orders'], summary: 'Read a saved order receipt',
        description: 'Immutable purchase snapshot; later catalog changes do not recalculate it.',
        parameters: [parameter('orderId', 'paste-order-id')],
        responses: {
          '200': success('Saved order.', ref('Order'), orderExample),
          ...failures({ '400': 'INVALID_REQUEST: Undecodable URL.', '404': 'ORDER_NOT_FOUND.' }),
        },
      },
    },
    '/admin/coupons': {
      post: {
        operationId: 'generateCoupon', tags: ['Administration'], summary: 'Generate one eligible milestone coupon',
        description: 'No authentication. Send `{}`. Generates the oldest reached, unrewarded milestone once. COUPON_INTERVAL (default 5) and DISCOUNT_PERCENT (default 10) are fixed at startup. There is no automatic generation during checkout. This endpoint is not idempotent: retrying may generate the next outstanding milestone.',
        requestBody: emptyBody,
        responses: {
          '201': success('One available coupon created. No Location header or coupon GET endpoint.', ref('Coupon'), couponExample),
          ...failures({ '400': invalidBody, '409': 'NO_ELIGIBLE_MILESTONE: No reached, unrewarded milestone is available.' }, true),
        },
      },
    },
    '/admin/report': {
      get: {
        operationId: 'getAdminReport', tags: ['Administration'], summary: 'Read reconciled sales and coupon totals',
        description: 'No authentication. Read-only snapshot derived from saved orders and actual coupon records. Quantities group by product ID, sorted by ID. Failed checkouts, active carts, and successful replays add no purchases. Reads never generate coupons or mutate counters.',
        responses: {
          '200': success('Report; an empty store has empty quantities and zero totals/counts.', ref('AdminReport'), {
            currency: 'INR', purchasedQuantityByProduct: [], grossRevenuePaise: 0,
            totalDiscountsPaise: 0, netRevenuePaise: 0, coupons: { generated: 0, available: 0, redeemed: 0 }, totalOrders: 0,
          }),
          ...failures({ '422': 'AMOUNT_OUT_OF_RANGE: A monetary or quantity aggregate exceeds the safe integer range.' }),
        },
      },
    },
  },
  components: {
    schemas: {
      EmptyObject: object({}),
      AddItem: object({ productId: { ...text, pattern: '\\S', example: 'product-1' }, quantity: integer(1) }),
      UpdateItem: object({ quantity: integer(1) }),
      Checkout: object({ couponCode: { ...text, maxLength: 128, pattern: '\\S', description: 'Optional nonblank, exact, case-sensitive code. Null is invalid.' } }, []),
      Product: object({ id: text, name: text, unitPricePaise: integer(), availableInventory: integer() }),
      Catalog: object({ currency, products: array(ref('Product')) }),
      CartItem: object({
        productId: text, name: text, quantity: integer(1), unitPricePaise: integer(),
        lineTotalPaise: integer(), availableInventory: integer(), isAvailable: { type: 'boolean' },
      }),
      Cart: object({
        id: text, status: { type: 'string', enum: ['active', 'checked_out'] },
        orderId: { type: 'string', nullable: true, description: 'Null while active; saved order ID after checkout.' },
        currency, items: array(ref('CartItem')), subtotalPaise: integer(),
      }),
      AppliedCoupon: appliedCoupon,
      Coupon: object({
        ...appliedCoupon.properties,
        status: { type: 'string', enum: ['available', 'redeemed'] },
        redeemedOrderId: { type: 'string', nullable: true, description: 'Null while available; saved order ID after redemption.' },
      }),
      OrderItem: object({ productId: text, name: text, quantity: integer(1), unitPricePaise: integer(), lineTotalPaise: integer() }),
      Order: object({
        id: text, cartId: text, status: { type: 'string', enum: ['placed'] },
        createdAt: { type: 'string', format: 'date-time' }, currency, items: { ...array(ref('OrderItem')), minItems: 1 },
        subtotalPaise: integer(), coupon: { ...appliedCoupon, nullable: true }, discountPaise: integer(), totalPaise: integer(),
      }),
      AdminReport: object({
        currency, purchasedQuantityByProduct: array(object({ productId: text, quantity: integer(1) })),
        grossRevenuePaise: integer(), totalDiscountsPaise: integer(), netRevenuePaise: integer(),
        coupons: object({ generated: integer(), available: integer(), redeemed: integer() }), totalOrders: integer(),
      }),
      Error: object({ error: object({
        code: text, message: text,
        details: { type: 'object', additionalProperties: true, description: 'Optional field or stock context.' },
      }, ['code', 'message']) }),
    },
  },
};
