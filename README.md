# Checkout and rewards service

Backend take-home assignment using Node.js, TypeScript, Express, and Vitest.
The complete requirements are preserved in [ASSIGNMENT.md](ASSIGNMENT.md).
The HTTP contract is in [API.md](API.md), and the design choices,
invariants, scope, and actual AI use are in [DECISIONS.md](DECISIONS.md).
The final backend requirement comparison and verification evidence are in
[AUDIT.md](AUDIT.md).
Health, catalog listing, cart lifecycle, checkout with optional coupons, order
retrieval, shared locking, key-based retries, coupon generation, and read-only
administrative reporting are implemented.

## Requirements and install

Use Node.js 24 or newer and npm. Run these commands from the repository root.
No credentials, database, or external application services are required;
`npm ci` installs the locked dependencies from the public npm registry.

```sh
npm ci
```

## Run

Start the development server with automatic reload:

```sh
npm run dev
```

The default port is 3000. Override it with `PORT=3001 npm run dev`.
Set environment variables in the shell; `.env` files are not loaded automatically.
Stop the server with Ctrl+C.

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
the seed catalog and clears carts/orders/coupons/keys. Development reloads also
reset this state.

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

## Administrative report

```sh
curl http://localhost:3000/admin/report
```

`GET /admin/report` is administrative and has no authentication. It returns
purchased quantities by product ID, gross revenue before discounts, total
discounts, net revenue, generated/available/redeemed coupon counts, and the
successfully placed order count. Amounts are integer paise; only purchased
products appear, sorted by ID. An empty store returns empty quantities and zero
totals/counts.

The report reads one committed state synchronously, using saved orders and coupon
records. Current catalog prices, active carts, failed checkouts, and successful
retries do not add revenue. Reading the report does not generate eligible coupons
or mutate state. A quantity or monetary aggregate outside the safe-integer range
returns 422 `AMOUNT_OUT_OF_RANGE` instead of an imprecise number.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

`npm run test:watch` runs Vitest in watch mode. HTTP tests start their own servers
on available loopback ports and close them afterward; do not start the app first.
The environment must permit binding local ports. Service/domain tests need no
server, database, or credentials. CI and request logging are deferred.

## Run the API example

[examples/checkout.mjs](examples/checkout.mjs) exercises all documented endpoints
using Node's built-in HTTP client and assertions. It creates six orders, so use a
fresh server with the default seed and these reward settings. Stop any existing
server first, then run:

```sh
COUPON_INTERVAL=5 DISCOUNT_PERCENT=10 npm run dev
```

In another terminal at the repository root:

```sh
node examples/checkout.mjs
```

For another port, pass the base URL, for example
`node examples/checkout.mjs http://localhost:3001`.
The same example works against `npm start` after building, with the same settings.

The example adds, updates, removes, and reads cart items; purchases five notebooks;
generates a coupon for milestone 5; buys two pens with 10% off; retries that
checkout with the same key; retrieves the saved order; and checks repeated reports
and remaining stock. It checks success statuses and cart/order Location headers.
The final report must contain six orders, gross revenue **67500**, discounts
**500**, net revenue **67000** paise, and one generated/redeemed coupon.
It prints the report and exits unsuccessfully on an unexpected response. If it
fails after making purchases, restart the server before trying again. It changes
only the running in-memory store, which is cleared on restart.

## Current scope

The backend provides the API contract above, shared validation and errors, exact
integer-paise arithmetic, and focused domain/service/HTTP tests.

Domain code lives in `src/domain/`: `types.ts` defines stored records and response
shapes, `validation.ts` rejects invalid quantities/percentages/paise, `errors.ts`
provides structured domain failures, and `money.ts` performs exact arithmetic
with `bigint` intermediates and safe numeric outputs. Rupee conversion takes a
decimal string rather than a floating-point number; formatted rupees are strings.

`src/store/` holds seed data and per-app in-memory state. `src/services/` contains
catalog/cart/checkout/order/coupon/report behavior, `src/routes/` translates HTTP
requests and responses, and `src/http/` parses JSON and formats errors. Each cart
write validates its proposed view/totals before replacing store state. Tests cover
cart lifecycle, validation failures, stock checks, current-price/availability views,
checkout failures, inventory deductions, and snapshots after catalog changes.

Every cart mutation, checkout, and coupon generation uses one FIFO mutex owned
by the store. State is captured after acquiring the lock, and changes are prepared
before publication.
Service and HTTP tests exercise last-item contention, matching retries, conflicting
keys, waiting edits, invalid headers, and recovery after a failed attempt.

The lock coordinates only services sharing that in-memory store in one process;
it does not coordinate independent instances or survive restart. Keys have no
expiry while the process runs. Reporting reads committed state without taking the
mutation lock or writing counters. API/operational review and the final backend
audit are complete; review, commit, and submission handoff remain pending.
All state is lost on restart. No frontend is included.
