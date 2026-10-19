# Checkout and rewards service

Checkout and rewards take-home assignment using Node.js, TypeScript, Express,
Vitest, and a small browser demo.
The complete requirements are preserved in [ASSIGNMENT.md](ASSIGNMENT.md).
The HTTP contract is in [API.md](API.md), and the design choices,
invariants, scope, and actual AI use are in [DECISIONS.md](DECISIONS.md).
The final backend requirement comparison and verification evidence are in
[AUDIT.md](AUDIT.md).
Health, catalog listing, cart lifecycle, checkout with optional coupons, order
retrieval, shared locking, key-based retries, coupon generation, and read-only
administrative reporting are implemented. The browser demo is served at `/`,
and interactive Swagger API documentation is at `/docs`.

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

## Interactive API documentation

After starting the server, open [Swagger UI](http://localhost:3000/docs).
Use the configured port if different. `/docs` and `/docs/` list all 11 API
operations, grouped by purpose, with request examples, response schemas,
statuses, and errors. The OpenAPI 3.0 specification is at
[/docs/openapi.json](http://localhost:3000/docs/openapi.json) for API tooling.
Swagger UI assets are installed locally through npm; no CDN or external
validation service is needed. Both development and compiled startup serve it.

Expand an endpoint, choose **Try it out**, edit the parameters/body, and select
**Execute**. Start with `GET /products`, create a cart with `POST /carts` and
body `{}`, then use its returned ID to add an item and check out. Checkout
requires an `Idempotency-Key`; choose a new value per purchase and reuse that
same value and body when retrying an uncertain result. For a coupon checkout,
select the **With a generated coupon** request example and replace its code.

These requests use the same running in-memory store as the browser demo.
Writes create real carts/orders and change stock/coupons in that process.
Administrative operations have no authentication. Restarting resets all data;
no real money is charged. The detailed contract remains in [API.md](API.md).

## Browser demo

Open [http://localhost:3000/](http://localhost:3000/) after starting the server.
Use the configured port if different. Both `npm run dev` and the compiled
`npm start` serve the same HTML/CSS/JavaScript from `public/`; no separate frontend
install or build is needed. Keep `public/` alongside `src/` and `dist/`.

The demo shows the catalog, creates a cart on the first addition, and supports
adding, changing quantities, removing items, and starting another cart. Checkout
accepts an optional coupon and shows the saved order receipt with its discount
and final total. The administration section generates eligible coupons and shows
the read-only report, with purchased quantities labelled by product name.
Successful checkout clears the cart panel and coupon input while keeping the
saved order receipt visible. Administration has no authentication, and checkout
does not charge real money.

For a shorter reward walkthrough, start a fresh server with:

```sh
COUPON_INTERVAL=2 DISCOUNT_PERCENT=10 npm run dev
```

1. Purchase a notebook, then a pen in a new cart.
2. Under **Store administration**, select **Generate coupon**.
3. Add a mug to a new cart, select **Use in cart**, and place the order.
4. The mug receipt shows ₹199.00 subtotal, ₹19.90 discount, and ₹179.10 total.
   The report shows three orders, ₹349.00 gross, ₹19.90 discounts, and ₹329.10 net.

All totals, discounts, stock decisions, and milestone eligibility come from the
API. **Refresh store** reloads catalog/cart/report data; **Refresh report** only
reads the report. Notifications use plain-language messages without backend error
codes. They slide in from the right, stay at the top-right while scrolling, and
can be dismissed with ×. **Copy code** copies the generated coupon;
**Use in cart** fills it in and automatically starts a cart if the previous cart
was checked out or no cart exists. A redeemed coupon shows **Already used**.
A failed checkout with a definite client error allows correction. A timeout,
network failure, or
server error retains the original checkout key/body and enables **Retry checkout**;
cart changes stay disabled until the result is confirmed.

Cart/receipt/latest-coupon selection and the retry key live in page memory.
Keep the page open while retrying an uncertain checkout. Reloading clears that
browser state while the running server retains its records; this small demo has
no saved-cart recovery or order history screen. Restarting the server resets all
data. Development reloads also reset server data, so reload the page afterward.

## Seeded catalog

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

## Coupon configuration

Startup settings are `COUPON_INTERVAL` (`n`, default 5, positive safe integer)
and `DISCOUNT_PERCENT` (`x`, default 10, integer 1–100). Values must use decimal
digits only. Invalid settings fail startup; settings stay fixed until restart.
For example:

```sh
COUPON_INTERVAL=2 DISCOUNT_PERCENT=10 npm run dev
```

After each two successfully placed orders in this example, an administrator can
generate one coupon for the oldest reached milestone that has not been rewarded.
With the defaults, the first coupon becomes eligible after five successful orders.
Generation is explicit, one coupon per request; milestone coupons can coexist.

## API routes

Start the server first, then set the base URL in the terminal used for these
examples. Change the port if needed:

```sh
BASE_URL='http://localhost:3000'
```

All API responses are JSON. Money fields ending in `Paise` use integer INR paise
(100 paise = ₹1). POST/PATCH requests require `Content-Type: application/json`
and a JSON object, including `{}` where shown. Unknown body properties and numeric
strings are rejected. Quantities must be positive safe integers; zero is invalid.
GET/DELETE requests below have no body. No query parameters or authentication are
required; `/admin/*` routes are administrative by convention only.

| Method | Route | Purpose | Success |
| --- | --- | --- | --- |
| GET | `/health` | Check process health | 200 |
| GET | `/products` | List current products and inventory | 200 |
| POST | `/carts` | Create an empty cart | 201 |
| GET | `/carts/:cartId` | Read a cart and current totals | 200 |
| POST | `/carts/:cartId/items` | Add an item or increment its quantity | 200 |
| PATCH | `/carts/:cartId/items/:productId` | Set an existing item's quantity | 200 |
| DELETE | `/carts/:cartId/items/:productId` | Remove an existing item | 200 |
| POST | `/carts/:cartId/checkout` | Place an order, optionally with a coupon | 201, including matching retries |
| GET | `/orders/:orderId` | Read a saved order receipt | 200 |
| POST | `/admin/coupons` | Generate one eligible milestone coupon | 201 |
| GET | `/admin/report` | Read reconciled sales and coupon totals | 200 |

### GET /health

```sh
curl -i "$BASE_URL/health"
```

Returns **200** with `{"status":"ok"}`. This checks whether the process can
answer HTTP requests.

### GET /products

```sh
curl -i "$BASE_URL/products"
```

Returns **200** with `currency` and a `products` array. Each product includes
`id`, `name`, `unitPricePaise`, and `availableInventory`. Use a returned product
ID when adding an item. Reading the catalog does not reserve inventory.

### POST /carts

```sh
curl -i -X POST "$BASE_URL/carts" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Returns **201** with an empty active cart and `Location: /carts/<id>`. Copy the
returned `id` into this variable for the cart examples:

```sh
CART_ID='paste-returned-cart-id'
```

Each call creates a separate cart. A missing body or extra JSON properties
returns **400** `INVALID_REQUEST`.

### GET /carts/:cartId

```sh
curl -i "$BASE_URL/carts/$CART_ID"
```

Returns **200** with cart status, `orderId`, `currency`, item quantities/current
prices, line totals, stock availability, and `subtotalPaise`. Active and
checked-out carts remain readable. Prices are current; use the order route for
the historical receipt. A missing cart returns **404** `CART_NOT_FOUND`.

### POST /carts/:cartId/items

```sh
curl -i -X POST "$BASE_URL/carts/$CART_ID/items" \
  -H 'Content-Type: application/json' \
  -d '{"productId":"product-1","quantity":1}'
```

Returns **200** with the updated cart. Adding the same product again increments
its quantity. Stock is checked but not reserved or deducted. Invalid quantities
return **400** `INVALID_QUANTITY`; missing carts/products return **404**;
insufficient stock or a checked-out cart returns **409**. Failed changes leave
the cart unchanged.

### PATCH /carts/:cartId/items/:productId

```sh
curl -i -X PATCH "$BASE_URL/carts/$CART_ID/items/product-1" \
  -H 'Content-Type: application/json' \
  -d '{"quantity":2}'
```

Returns **200** with the updated cart. This sets the absolute quantity to two.
Use DELETE to remove an item; setting zero returns **400** `INVALID_QUANTITY`.
A missing cart/product/line returns **404**; insufficient stock or a checked-out
cart returns **409**.

### DELETE /carts/:cartId/items/:productId

```sh
curl -i -X DELETE "$BASE_URL/carts/$CART_ID/items/product-1"
```

Returns **200** with the updated cart. Repeating removal returns **404**
`CART_ITEM_NOT_FOUND`; a checked-out cart returns **409**
`CART_ALREADY_CHECKED_OUT`. If this removes the last item, add an item again
using the POST example before checking out.

### POST /carts/:cartId/checkout

Use an active, nonempty cart. Without a coupon:

```sh
curl -i -X POST "$BASE_URL/carts/$CART_ID/checkout" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-1' \
  -d '{}'
```

With a coupon, create/populate another cart, set `CART_ID` to its returned ID,
and use an available code from the administrator coupon route:

```sh
COUPON_CODE='paste-generated-coupon-code'
curl -i -X POST "$BASE_URL/carts/$CART_ID/checkout" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-with-coupon-1' \
  -d "{\"couponCode\":\"$COUPON_CODE\"}"
```

Returns **201** with the order snapshot and `Location: /orders/<id>`. The receipt
contains purchased items/prices, subtotal, applied coupon or `null`, discount,
and final total. Stock is deducted and the cart becomes `checked_out`.
Successful checkout counts as payment success; no real money is charged.

Checkout requires exactly one `Idempotency-Key` of 1–128 letters, digits, dots,
underscores, colons, or hyphens. Choose a new key for each purchase. After an
uncertain result, retry with the **same key, cart ID, and coupon body**. A matching
successful retry returns the original **201**, order, and Location without
another purchase, stock deduction, or coupon redemption. Reusing a successful
key with a different cart/coupon returns **409** `IDEMPOTENCY_KEY_CONFLICT`.
A new key on a completed cart returns **409** `CART_ALREADY_CHECKED_OUT`.

Missing/invalid keys or malformed coupon values return **400**; missing
carts/products return **404**; an empty cart, insufficient stock, or unknown/used
coupon returns **409**. Unsafe calculated amounts return **422**. Failed
validation leaves stock, cart, order, key, and coupon state unchanged. An
unsuccessful first attempt leaves its key unbound.

Coupons are shared, case-sensitive, have no expiry, and are single-use. One coupon
can be applied per order. Discounts use half-up rounding once on the subtotal;
a 100% discount produces a valid zero-total order.

### GET /orders/:orderId

Copy the successful checkout response's `id` into `ORDER_ID`:

```sh
ORDER_ID='paste-returned-order-id'
curl -i "$BASE_URL/orders/$ORDER_ID"
```

Returns **200** with the immutable purchase receipt, including product names,
quantities, prices, coupon details, and totals. Later catalog changes do not
alter it. A missing order returns **404** `ORDER_NOT_FOUND`.

### POST /admin/coupons

**Administrative; no authentication.** Reach an unrewarded successful-order
milestone first, then request a coupon:

```sh
curl -i -X POST "$BASE_URL/admin/coupons" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Returns **201** with `code`, `milestone`, `discountPercent`, `status: "available"`,
and `redeemedOrderId: null`. Use the returned code in a later checkout.
No eligible milestone returns **409** `NO_ELIGIBLE_MILESTONE`. Generation is
explicit and limited to one coupon per milestone; there is no automatic
generation during checkout. This route is not idempotent: retrying may generate
the next outstanding milestone. Settings come from startup configuration, not
the request body.

### GET /admin/report

**Administrative; no authentication.**

```sh
curl -i "$BASE_URL/admin/report"
```

Returns **200** with `purchasedQuantityByProduct`, `grossRevenuePaise`,
`totalDiscountsPaise`, `netRevenuePaise`, coupon counts (`generated`, `available`,
`redeemed`), `totalOrders`, and `currency`. Only purchased products appear,
grouped/sorted by product ID. An empty store returns empty quantities and zero
totals/counts.

The report reads one committed state synchronously, using saved orders and coupon
records. Current catalog prices, active carts, failed checkouts, and successful
retries do not add revenue. Reading the report does not generate eligible coupons
or mutate state. A quantity or monetary aggregate outside the safe-integer range
returns 422 `AMOUNT_OUT_OF_RANGE` instead of an imprecise number.

### Common errors and full contract

Errors use `{"error":{"code":"...","message":"..."}}`, with optional
`details` for validation/stock context. Common failures include **400** for
malformed JSON or invalid input, **404** for missing resources, **409** for
business conflicts, **413** for JSON bodies above 100 KiB, **415** for unsupported
media types/charsets/encodings, **422** for unsafe calculated amounts, and **500**
for unexpected failures. Error codes are stable; message text is not a client
contract. See [API.md](API.md) for complete response shapes and error cases, or
use [Swagger UI](http://localhost:3000/docs) to execute requests interactively.

The browser demo is served at `GET /`, Swagger UI at `GET /docs` (also `/docs/`),
and the machine-readable specification at `GET /docs/openapi.json`.

## Checks

```sh
npm test
npm run typecheck
npm run build
node --check public/app.js
node --check public/client.js
```

`npm run test:watch` runs Vitest in watch mode. HTTP tests start their own servers
on available loopback ports and close them afterward; do not start the app first.
The environment must permit binding local ports. Service/domain tests need no
server, database, or credentials. CI and request logging are deferred.
`npm run typecheck` checks TypeScript source/tests; the browser JavaScript has
client behavior tests, syntax checks above, and manual browser verification.

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
mutation lock or writing counters. API/operational review, the backend audit,
and final acceptance verification are recorded in [AUDIT.md](AUDIT.md).
All server state is lost on restart. The optional browser demo calls the same API;
business rules remain in the backend.
