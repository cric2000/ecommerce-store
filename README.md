# Checkout and rewards service

Backend take-home assignment using Node.js, TypeScript, Express, and Vitest.
The complete requirements are preserved in [ASSIGNMENT.md](ASSIGNMENT.md).
The planned HTTP contract is in [API.md](API.md), and the design choices,
invariants, scope, and actual AI use are in [DECISIONS.md](DECISIONS.md).
Health, catalog listing, cart lifecycle, checkout with optional coupons, order
retrieval, shared locking, key-based retries, and coupon generation are implemented.
Reporting is planned.

## Requirements and install

Use Node.js 24 or newer and npm. No credentials or external services are required.

```sh
npm ci
```

## Run

Start the development server with automatic reload:

```sh
npm run dev
```

The default port is 3000. Override it with `PORT=3001 npm run dev`.

To compile and run the JavaScript build:

```sh
npm run build
npm start
```

## Health endpoint

```sh
curl -i http://localhost:3000/health
```

`GET /health` returns HTTP 200 with `{"status":"ok"}`. It requires no request body.

## Seeded catalog and carts

Five products are seeded automatically when an app/store starts. No separate
seed command is needed. All data is in memory: restarting the process restores
the seed catalog and clears carts/orders/coupons/keys. No private service or credentials are
used.

| Product ID | Name | Unit price (paise) | Inventory |
| --- | --- | --- | --- |
| `product-1` | Notebook | 12500 | 50 |
| `product-2` | Pen | 2500 | 100 |
| `product-3` | Mug | 19900 | 20 |
| `product-4` | Backpack | 149900 | 10 |
| `product-5` | Desk lamp | 74900 | 1 |

```sh
curl http://localhost:3000/products
curl -i -H 'Content-Type: application/json' -d '{}' http://localhost:3000/carts
```

Use the returned cart ID with the add/update/remove/read endpoints in
[API.md](API.md). Adding an existing product increments its quantity; PATCH sets
the absolute quantity; DELETE removes the line. Zero is not a valid quantity.
Cart changes check stock but do not reserve or reduce it. Views use current
prices and retain requested quantities when availability falls, marking those
lines `isAvailable: false`. Checkout rechecks current prices and stock.

## Checkout and orders

After adding items, replace `CART_ID` in this request with the returned cart ID:

```sh
curl -i -H 'Content-Type: application/json' -H 'Idempotency-Key: checkout-1' -d '{}' http://localhost:3000/carts/CART_ID/checkout
```

Checkout returns HTTP 201, the order snapshot, and a `Location: /orders/<id>`
header. Read that order with `GET /orders/<id>`. It preserves product IDs/names,
quantities, unit prices, line totals, subtotal, applied coupon, discount, and
final total after later catalog changes. Successful checkout counts as payment
success; no real payment is performed.

The checked-out cart cannot be edited or checked out again. It remains readable
with its `orderId`; use the order endpoint for the historical purchase receipt.
Checkout accepts `{}` or one optional `couponCode` and requires exactly one
`Idempotency-Key`.
Use a new key for each new purchase; reuse it only to retry that same request.
A matching successful retry returns the original 201, order body, and Location,
without another order or stock deduction. Reusing a successful key for a different
cart or coupon returns 409 `IDEMPOTENCY_KEY_CONFLICT`; using a fresh key on a completed cart
returns 409 `CART_ALREADY_CHECKED_OUT`. Failed attempts do not bind the key.
Failed validation leaves stock/cart/order/key/coupon state unchanged.

## Coupon rewards

Startup settings are `COUPON_INTERVAL` (`n`, default 5, positive safe integer)
and `DISCOUNT_PERCENT` (`x`, default 10, integer 1–100). Values must use decimal
digits only. Invalid settings fail startup; settings stay fixed until restart.
For example:

```sh
COUPON_INTERVAL=2 DISCOUNT_PERCENT=10 npm run dev
```

After each two successfully placed orders in this example, an administrator can
request one coupon for the oldest reached milestone that has not been rewarded:

```sh
curl -i -H 'Content-Type: application/json' -d '{}' http://localhost:3000/admin/coupons
```

This administrative route has no authentication. It returns 201 and the coupon,
or 409 `NO_ELIGIBLE_MILESTONE`. Generation is explicit, one coupon per request;
retries may generate the next outstanding milestone. Milestone coupons can coexist.

To redeem a returned code, use an active cart, a new checkout key, and replace
`COUPON_CODE` below with the actual code:

```sh
curl -i -H 'Content-Type: application/json' -H 'Idempotency-Key: checkout-with-coupon-1' -d '{"couponCode":"COUPON_CODE"}' http://localhost:3000/carts/CART_ID/checkout
```

Coupons are shared, case-sensitive, have no expiry, and are single-use. One coupon
can be applied per checkout. The whole subtotal is discounted with half-up
rounding in paise; 100% discounts produce zero-total successful orders. A failed
checkout does not consume a coupon. Matching checkout retries return the original
order without redeeming again; changing the coupon on a successful key conflicts.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

`npm run test:watch` runs Vitest in watch mode. The health test starts an HTTP
server on an available loopback port and closes it after the test.

## Current scope

Tasks 1–7 provide project tooling, app/server entry points, the health endpoint,
the planned API contract/design documentation, domain types, shared validation
and errors, and exact integer-paise money helpers with focused tests.

Domain code lives in `src/domain/`: `types.ts` defines stored records and response
shapes, `validation.ts` rejects invalid quantities/percentages/paise, `errors.ts`
provides structured domain failures, and `money.ts` performs exact arithmetic
with `bigint` intermediates and safe numeric outputs. Rupee conversion takes a
decimal string rather than a floating-point number; formatted rupees are strings.

`src/store/` holds seed data and per-app in-memory state. `src/services/` contains
catalog/cart/checkout/order behavior, `src/routes/` translates HTTP requests and
responses, and `src/http/` parses JSON and formats errors. Each cart write validates its proposed
view/totals before replacing store state. Service and HTTP tests cover cart
lifecycle, validation failures, stock checks, current-price/availability views,
checkout failures, inventory deductions, and snapshots after catalog changes.

Every cart mutation, checkout, and coupon generation uses one FIFO mutex owned
by the store. State
is captured after acquiring the lock, and changes are prepared before publication.
Service and HTTP tests exercise last-item contention, matching retries, conflicting
keys, waiting edits, invalid headers, and recovery after a failed attempt.

The lock coordinates only services sharing that in-memory store in one process;
it does not coordinate independent instances or survive restart. Keys have no
expiry while the process runs. Reports remain pending Task 8.
All state is lost on restart. No frontend is included.
