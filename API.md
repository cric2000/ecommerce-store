# HTTP API contract

**Status:** Only `GET /health` exists today. All other endpoints and shared error
handling below are the planned contract for later tasks, pending review.
This document does not claim they already work. See [DECISIONS.md](DECISIONS.md)
for the reasons, invariants, and limitations.

## Common conventions

- Base URL: `http://localhost:3000`; `PORT` can override the port.
- No authentication is implemented or required. `/admin/*` operations are
  administrative by convention only.
- Request bodies use `Content-Type: application/json`. Responses use JSON except
  where explicitly stated otherwise. Body-bearing endpoints require a JSON object,
  including `{}` when no properties are needed. For endpoints documented with no
  body, clients should omit it. No query parameters are defined.
- IDs are opaque, case-sensitive strings. Product IDs come from the catalog;
  clients use returned cart/order IDs and coupon codes without interpreting them.
- Reject unknown JSON properties, malformed JSON, wrong types, and numeric strings.
  Quantities must be positive safe integers. Use DELETE to remove an item; setting
  quantity to zero is invalid.
- Currency is `INR`. All fields ending in `Paise` are nonnegative safe integer
  amounts; 100 paise = 1 rupee. Apply discounts once to the subtotal with half-up
  rounding, as specified in DECISIONS.md.
- Coupon codes are nonblank strings of at most 128 characters and are matched
  exactly, without trimming or case conversion. `null` is not a valid coupon code.
- `Idempotency-Key` is required only on checkout. Use one value matching
  `[A-Za-z0-9._:-]{1,128}` (for example a UUID); missing, repeated, or invalid key
  headers return 400. Keys are global within the running store, not scoped to carts.
- Array ordering: products/cart lines/report product quantities sort by product ID;
  orders preserve the line ordering accepted at checkout.
- Business errors use the common envelope below. When multiple business checks
  fail, clients should not depend on a particular error winning. Successful key
  lookup always precedes live cart/inventory/coupon validation.

## Endpoint index

| Method and path | Purpose | Success | Administrative | Status |
| --- | --- | --- | --- | --- |
| `GET /health` | Liveness | 200 | No | Implemented |
| `GET /products` | Current catalog | 200 | No | Planned |
| `POST /carts` | Create cart | 201 | No | Planned |
| `GET /carts/:cartId` | Read cart/current totals | 200 | No | Planned |
| `POST /carts/:cartId/items` | Add/increment item | 200 | No | Planned |
| `PATCH /carts/:cartId/items/:productId` | Set item quantity | 200 | No | Planned |
| `DELETE /carts/:cartId/items/:productId` | Remove item | 200 | No | Planned |
| `POST /carts/:cartId/checkout` | Place order, optional coupon | 201 (also replay) | No | Planned |
| `GET /orders/:orderId` | Read purchase snapshot | 200 | No | Planned |
| `POST /admin/coupons` | Generate one eligible coupon | 201 | Yes | Planned |
| `GET /admin/report` | Reconciled read-only report | 200 | Yes | Planned |

## Response shapes

Examples use readable placeholder IDs and an illustrative one-item purchase.
They do not define the final seed catalog. Fields are required unless marked
optional; nullable fields explicitly use `null`.

### Product

```json
{
  "id": "product-1",
  "name": "Notebook",
  "unitPricePaise": 105,
  "availableInventory": 3
}
```

The catalog response supplies the currency alongside its product array.
Inventory and unit prices are nonnegative safe integers; a zero-priced product
is allowed. No catalog mutation HTTP endpoint is planned.

### Cart

```json
{
  "id": "cart-1",
  "status": "active",
  "orderId": null,
  "currency": "INR",
  "items": [
    {
      "productId": "product-1",
      "name": "Notebook",
      "quantity": 1,
      "unitPricePaise": 105,
      "lineTotalPaise": 105,
      "availableInventory": 3,
      "isAvailable": true
    }
  ],
  "subtotalPaise": 105
}
```

An empty cart has `items: []` and `subtotalPaise: 0`. Each line's `isAvailable`
means current inventory is at least its requested quantity. A stock change does
not silently remove/reduce an existing line. The subtotal is before discounts;
coupons apply only during checkout. A checked-out cart has `status: "checked_out"`
and its non-null `orderId`. Its cart view still uses current catalog data, not
historical purchase data; use the order endpoint for the immutable receipt.

### Order

```json
{
  "id": "order-1",
  "cartId": "cart-1",
  "status": "placed",
  "createdAt": "2026-10-19T09:00:00.000Z",
  "currency": "INR",
  "items": [
    {
      "productId": "product-1",
      "name": "Notebook",
      "quantity": 1,
      "unitPricePaise": 105,
      "lineTotalPaise": 105
    }
  ],
  "subtotalPaise": 105,
  "coupon": {
    "code": "coupon-5",
    "milestone": 5,
    "discountPercent": 10
  },
  "discountPaise": 11,
  "totalPaise": 94
}
```

Without a coupon, `coupon` is null, `discountPaise` is 0, and `totalPaise` equals
`subtotalPaise`. All purchase fields are snapshots; later product changes cannot
alter them. A placed order counts as payment success; no payment is performed.

### Coupon

```json
{
  "code": "coupon-5",
  "milestone": 5,
  "discountPercent": 10,
  "status": "available",
  "redeemedOrderId": null
}
```

After successful redemption, status is `redeemed` and `redeemedOrderId` is the
order ID. Generation returns a coupon; orders preserve the applied code,
milestone, and percentage. No separate coupon listing endpoint is required.

### Error

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Requested quantity exceeds available inventory",
    "details": {
      "productId": "product-1",
      "requestedQuantity": 2,
      "availableInventory": 1
    }
  }
}
```

`code` is stable; human-readable `message` text is not a client contract.
`details` is optional. Validation errors may identify a `field`; stock errors
include the fields shown above. Unexpected errors return `INTERNAL_ERROR` and a
generic message without exception details.

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Malformed JSON |
| 400 | `INVALID_REQUEST` | Wrong/missing object body, unknown fields, or invalid property type/value other than quantity |
| 400 | `INVALID_QUANTITY` | Quantity is missing, not a positive safe integer, or is a numeric string |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Checkout key missing, repeated, or outside the documented format |
| 404 | `PRODUCT_NOT_FOUND` | Referenced product absent from catalog |
| 404 | `CART_NOT_FOUND` | Cart ID not found |
| 404 | `CART_ITEM_NOT_FOUND` | Existing cart has no line for the requested product |
| 404 | `ORDER_NOT_FOUND` | Order ID not found |
| 404 | `ROUTE_NOT_FOUND` | No matching route/method |
| 409 | `CART_ALREADY_CHECKED_OUT` | Attempted mutation/new checkout of a completed cart |
| 409 | `EMPTY_CART` | Checkout has no items |
| 409 | `INSUFFICIENT_STOCK` | Requested quantity cannot currently be supplied |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | Successful key already belongs to another request identity |
| 409 | `INVALID_COUPON` | Well-formed code does not identify a coupon |
| 409 | `COUPON_ALREADY_REDEEMED` | Coupon already belongs to another successful order |
| 409 | `NO_ELIGIBLE_MILESTONE` | No reached, unrewarded milestone is available |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body-bearing route is not sent as JSON |
| 422 | `AMOUNT_OUT_OF_RANGE` | Computed monetary value or report quantity aggregate cannot be represented safely |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |

Malformed JSON/shape, media-type, range, and unexpected errors apply wherever
relevant in addition to the important endpoint-specific errors listed below.
These shared error responses are planned; the current health-only scaffold does
not yet normalize Express errors/404s.

## GET /health

**Implemented. Non-administrative.** No body or special headers.

Response: **200 OK** with `{"status":"ok"}`. This indicates the process can answer
HTTP, not persistence, inventory integrity, or payment readiness.

## GET /products

**Planned. Non-administrative.** No request body.

Response: **200 OK**, `{ "currency": "INR", "products": [Product] }`, using the
Product shape above. At least five products will be seeded at startup, including
one with limited inventory. This read does not reserve inventory. No expected
domain errors for a normal request.

## POST /carts

**Planned. Non-administrative.** Request body: `{}`.

Response: **201 Created**, an empty active Cart. Include
`Location: /carts/<returned-id>`. This endpoint has no idempotency behavior;
repeating it creates another cart. Important error: `INVALID_REQUEST` (400).

## GET /carts/:cartId

**Planned. Non-administrative.** No request body.

Response: **200 OK**, a Cart with current catalog prices/inventory. Works for
active and checked-out carts. Important errors: `CART_NOT_FOUND` (404),
`PRODUCT_NOT_FOUND` (404) if a referenced catalog product has disappeared.
Insufficient current stock is shown via `isAvailable: false`, not a read error.

## POST /carts/:cartId/items

**Planned. Non-administrative.** Example body:

```json
{ "productId": "product-1", "quantity": 2 }
```

Add a line, or increment an existing line by `quantity`. Validate the resulting
quantity and current stock; do not reserve/deduct inventory. A failed addition
leaves the cart unchanged. Response: **200 OK**, updated Cart.

Important errors: `INVALID_REQUEST`/`INVALID_QUANTITY` (400);
`CART_NOT_FOUND`/`PRODUCT_NOT_FOUND` (404); `CART_ALREADY_CHECKED_OUT` or
`INSUFFICIENT_STOCK` (409). Reject an unsafe resulting quantity as
`INVALID_QUANTITY` (400).

## PATCH /carts/:cartId/items/:productId

**Planned. Non-administrative.** Example body:

```json
{ "quantity": 3 }
```

Set an existing line's absolute quantity. Zero is invalid. Validate product and
current stock, without reserving inventory. A failure leaves the cart unchanged.
Response: **200 OK**, updated Cart.

Important errors: `INVALID_REQUEST`/`INVALID_QUANTITY` (400);
`CART_NOT_FOUND`/`PRODUCT_NOT_FOUND`/`CART_ITEM_NOT_FOUND` (404);
`CART_ALREADY_CHECKED_OUT` or `INSUFFICIENT_STOCK` (409).

## DELETE /carts/:cartId/items/:productId

**Planned. Non-administrative.** No request body. Remove the existing line.

Response: **200 OK**, updated Cart. Important errors:
`CART_NOT_FOUND`/`CART_ITEM_NOT_FOUND` (404), `CART_ALREADY_CHECKED_OUT` (409).
Repeating removal returns `CART_ITEM_NOT_FOUND`, not a second success.

## POST /carts/:cartId/checkout

**Planned. Non-administrative.** Required header:
`Idempotency-Key: 0ddf3c21-f738-4ad6-90d3-3e414de061e6`.

Request body without a coupon: `{}`. With a coupon:

```json
{ "couponCode": "coupon-5" }
```

At most one coupon is accepted; arrays/extra properties/null codes are invalid.
Revalidate the active cart, nonempty items, current product prices/stock, and any
coupon. Stage all calculations/state changes; create an immutable order, reduce
inventory, close the cart, redeem the coupon if provided, and remember the
successful key as one commit. Failure before commit changes none of these
records. If the commit succeeds but the response is lost, retry with the same
key to retrieve the committed order.

Response: **201 Created**, an Order, with `Location: /orders/<returned-id>`.

Retry rules:

- The same successful key and normalized `(cartId, couponCode-or-absent)` request
  returns the original 201, Order body, and Location. It creates no order and
  changes no stock/coupon state, even if current catalog or cart state differs.
- A successful key with a different cart ID or coupon returns
  `IDEMPOTENCY_KEY_CONFLICT` (409). JSON formatting does not change identity.
- Failures do not bind/cache the key. Fixing a failed cart and retrying the same
  key uses the cart's latest state.
- A checked-out cart with a fresh key returns `CART_ALREADY_CHECKED_OUT` (409).
- Concurrent identical successful retries return one and the same order. Two
  carts competing for remaining stock or one coupon cannot both consume it.
- Keys/results last only until process restart. Retries of cart creation or
  administrative generation do not receive checkout's idempotency guarantees.

Important errors: `INVALID_REQUEST`/`INVALID_IDEMPOTENCY_KEY` (400);
`CART_NOT_FOUND`/`PRODUCT_NOT_FOUND` (404); `EMPTY_CART`,
`CART_ALREADY_CHECKED_OUT`, `INSUFFICIENT_STOCK`, `INVALID_COUPON`,
`COUPON_ALREADY_REDEEMED`, or `IDEMPOTENCY_KEY_CONFLICT` (409).

Task 5 will first implement this endpoint without coupons, Task 6 adds the key
and competing-operation guarantees, and Task 7 adds coupon acceptance. Until
those tasks finish, this is the target contract, not an implementation claim.

## GET /orders/:orderId

**Planned. Non-administrative.** No request body.

Response: **200 OK**, the immutable Order shape. Important error:
`ORDER_NOT_FOUND` (404). Reads never recalculate from the current catalog.

## POST /admin/coupons

**Planned. Administrative; no authentication.** Request body: `{}`. Configuration
comes from startup environment values, not this request:

| Variable | Meaning | Default | Allowed values |
| --- | --- | --- | --- |
| `COUPON_INTERVAL` | `n`, successful orders per milestone | 5 | Positive safe integer |
| `DISCOUNT_PERCENT` | `x`, coupon percent off | 10 | Integer 1–100 |

Response: **201 Created**, a Coupon for the oldest reached milestone without a
coupon record. No Location header is promised because there is no coupon GET
endpoint. Generated codes are opaque and unique within the store.

Example: with `n=5` and 12 successful orders, successive calls generate one
coupon for milestone 5, then one for milestone 10, then return 409. Coupons can
coexist and do not expire. Redemption never reopens a milestone. There is no
automatic generation during checkout.

Important errors: `INVALID_REQUEST` (400), `NO_ELIGIBLE_MILESTONE` (409).
Generation is serialized with checkout. Concurrent calls can generate different
eligible milestones, never duplicate one. Retrying a lost admin response may
generate the next outstanding milestone; this endpoint does not accept an
idempotency key.

## GET /admin/report

**Planned. Administrative; no authentication.** No request body.

Response: **200 OK**, for example:

```json
{
  "currency": "INR",
  "purchasedQuantityByProduct": [
    { "productId": "product-1", "quantity": 6 }
  ],
  "grossRevenuePaise": 630,
  "totalDiscountsPaise": 11,
  "netRevenuePaise": 619,
  "coupons": {
    "generated": 1,
    "available": 0,
    "redeemed": 1
  },
  "totalOrders": 6
}
```

This example represents six one-item orders at 105 paise each: the first five
earned a milestone-5 coupon, generated by an administrator and then applied to
the sixth order. The sixth order is the discounted Order example above.

Sum purchased quantities by product ID from placed order lines, gross revenue
from subtotals, discounts from order discounts, and net revenue from order
totals. Count orders and actual coupon records. Include only purchased products,
sorted by ID. An empty system returns `[]` and zero for all totals/counts.
Repeated reads do not generate coupons, advance milestones, or mutate counters.
No expected domain conflicts; `AMOUNT_OUT_OF_RANGE` (422) applies if an aggregate
would exceed safe numeric output. The report reflects one store snapshot.
