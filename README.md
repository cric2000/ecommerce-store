# Checkout and rewards service

[Live demo](https://ecommerce-store-seven-opal.vercel.app/) ·
[Swagger API](https://ecommerce-store-seven-opal.vercel.app/docs)

A checkout and rewards service built with Node.js, TypeScript, Express, and Vitest.
It includes cart management, checkout with retry protection, inventory updates,
milestone coupons, sales reporting, and a browser demo.

## Requirements and install

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
```

The default local mode needs no database or credentials.

## Run

Start the development server with automatic reload:

```sh
npm run dev
```

Open the [browser demo](http://localhost:3000/) or
[local Swagger UI](http://localhost:3000/docs). No separate frontend build is needed.
The default port is 3000; override it with `PORT=3001 npm run dev`.
Environment variables come from the shell; `.env` files are not loaded automatically.

To compile and run the JavaScript build:

```sh
npm run build
npm start
```

## Storage modes

| Mode | Selection | Behavior |
| --- | --- | --- |
| Local memory | Neither database URL is set | Restarting resets products, carts, orders, coupons, and checkout keys |
| PostgreSQL | `DATABASE_URL` or fallback `POSTGRES_URL` is set | Instances share durable state; restarts and deployments preserve it |

PostgreSQL creates the table and seeds each new namespace automatically. Writes
commit inventory, orders, cart closure, coupon redemption, and retry keys together
before responding. Reads see a complete committed snapshot.

| Setting | Purpose | Default |
| --- | --- | --- |
| `PORT` | Local HTTP port | `3000` |
| `DATABASE_URL` | Pooled PostgreSQL URL; `POSTGRES_URL` is a fallback | Unset |
| `STORE_NAMESPACE` | Independent store within the database | `ecommerce` |
| `COUPON_INTERVAL` | Successful orders per reward milestone | `5` |
| `DISCOUNT_PERCENT` | Coupon percentage | `10` |

Reward settings load at memory-store startup or when a PostgreSQL namespace is
first initialized. An existing namespace keeps its saved settings; changing them
requires a data migration or a new namespace. `COUPON_INTERVAL` must be a positive
safe integer and `DISCOUNT_PERCENT` an integer from 1–100; use decimal digits only.

To use PostgreSQL locally, copy [.env.example](.env.example) to `.env`, set the
connection URL, and load it explicitly:

```sh
cp .env.example .env
npm run build
node --env-file=.env dist/server.js
```

Credential files (`.env`, `.env.*`) and `.vercel/` are ignored by Git;
the tracked `.env.example` contains placeholders only.

## Browser demo

The demo supports catalog browsing, cart edits, optional coupon checkout, receipts,
and administrative reporting. Successful checkout clears the cart and retains its
receipt. Purchased quantities are grouped by product across all orders.

For a shorter coupon walkthrough, start a fresh memory-mode server with database
URLs unset:

```sh
COUPON_INTERVAL=2 DISCOUNT_PERCENT=10 npm run dev
```

1. Purchase a notebook, then a pen in a new cart.
2. Under **Store administration**, select **Generate coupon**.
3. Add a mug, select **Use in cart**, and place the order.
4. The receipt shows ₹199.00 subtotal, ₹19.90 discount, and ₹179.10 total.

An uncertain checkout keeps its original key/body for **Retry checkout**. Keep the
page open until the result is confirmed: reloading clears the selected cart,
receipt, coupon, and retry state. There is no saved-cart recovery or order history
screen. Reload the page after restarting a memory-mode server.

## Interactive API documentation

Swagger UI at `/docs` lists all 11 operations with request examples and response
schemas. Choose **Try it out**, edit the request, and select **Execute**.
The OpenAPI document is at [/docs/openapi.json](http://localhost:3000/docs/openapi.json).
Swagger assets are served locally, and requests use the same store as the demo.

## Seeded catalog

Each new store starts with these products:

| Product ID | Name | Unit price (paise) | Inventory |
| --- | --- | --- | --- |
| `product-1` | Notebook | 12500 | 50 |
| `product-2` | Pen | 2500 | 100 |
| `product-3` | Mug | 19900 | 20 |
| `product-4` | Backpack | 149900 | 10 |
| `product-5` | Desk lamp | 74900 | 1 |

## API routes

Start the server first, then set the base URL in the terminal used for these
examples. Change the port if needed:

```sh
BASE_URL='http://localhost:3000'
```

Responses are JSON. Money fields ending in `Paise` use integer INR paise
(100 paise = ₹1). POST/PATCH requests require a JSON object and
`Content-Type: application/json`. Quantities must be positive integers.
Administrative routes are public, and checkout does not charge real money.

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

Returns `{"status":"ok"}` when the process can answer HTTP requests.

### GET /products

```sh
curl -i "$BASE_URL/products"
```

Returns `currency` and `products`, including IDs, names, prices, and available stock.

### POST /carts

```sh
curl -i -X POST "$BASE_URL/carts" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Returns an empty active cart. Copy its `id` for the following requests:

```sh
CART_ID='paste-returned-cart-id'
```

### GET /carts/:cartId

```sh
curl -i "$BASE_URL/carts/$CART_ID"
```

Returns cart status, items, current prices, stock availability, and subtotal.

### POST /carts/:cartId/items

```sh
curl -i -X POST "$BASE_URL/carts/$CART_ID/items" \
  -H 'Content-Type: application/json' \
  -d '{"productId":"product-1","quantity":1}'
```

Returns the updated cart. Repeated additions increment quantity; stock is checked
but not reserved or deducted until checkout.

### PATCH /carts/:cartId/items/:productId

```sh
curl -i -X PATCH "$BASE_URL/carts/$CART_ID/items/product-1" \
  -H 'Content-Type: application/json' \
  -d '{"quantity":2}'
```

Sets the quantity to two and returns the updated cart. Use DELETE to remove an item.

### DELETE /carts/:cartId/items/:productId

```sh
curl -i -X DELETE "$BASE_URL/carts/$CART_ID/items/product-1"
```

Removes the item and returns the updated cart. If following these examples in
order, add an item again before checkout.

### POST /carts/:cartId/checkout

Use an active, nonempty cart:

```sh
curl -i -X POST "$BASE_URL/carts/$CART_ID/checkout" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-1' \
  -d '{}'
```

Returns a saved order, deducts stock, and closes the cart. Choose a new key for
each purchase. To retry an uncertain result, reuse the **same key, cart ID, and
body**; a matching successful retry returns the original order without another purchase.

To apply a coupon, create and populate another cart, update `CART_ID`, and use an
available code from the coupon route:

```sh
COUPON_CODE='paste-generated-coupon-code'
curl -i -X POST "$BASE_URL/carts/$CART_ID/checkout" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-with-coupon-1' \
  -d "{\"couponCode\":\"$COUPON_CODE\"}"
```

Coupons are shared and single-use, with at most one per order.

### GET /orders/:orderId

Copy the checkout response's `id` into `ORDER_ID`:

```sh
ORDER_ID='paste-returned-order-id'
curl -i "$BASE_URL/orders/$ORDER_ID"
```

Returns the saved receipt with purchased items, prices, discounts, and final total.

### POST /admin/coupons

```sh
curl -i -X POST "$BASE_URL/admin/coupons" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Generates one coupon for an eligible, unrewarded order milestone. With the defaults,
the first becomes eligible after five successful orders. Returns its code and
discount; returns 409 when no milestone is eligible. Generation is explicit and
limited to one coupon per milestone.

### GET /admin/report

```sh
curl -i "$BASE_URL/admin/report"
```

Returns order count, purchased quantities grouped by product, gross revenue,
discounts, net revenue, and coupon counts. Reading the report does not change state.

Errors use `{"error":{"code":"...","message":"..."}}`, with optional `details`.
See [API.md](API.md) for complete response shapes, validation rules, and error cases.

## Checks

```sh
npm test
npm run typecheck
npm run build
node --check public/app.js
node --check public/client.js
```

HTTP tests start and close their own servers on available loopback ports; no
running app is needed. `npm run test:watch` enables watch mode.

PostgreSQL integration tests require `TEST_DATABASE_URL`; otherwise they are
skipped. Use a dedicated test database: tests create/remove isolated namespaces
and temporarily add a constraint to exercise rollback. With Docker:

```sh
docker run --name ecommerce-store-postgres --rm -d \
  -e POSTGRES_PASSWORD=ecommerce-local-test -e POSTGRES_DB=ecommerce_test \
  -p 127.0.0.1:55432:5432 postgres:18-alpine
docker exec ecommerce-store-postgres pg_isready -U postgres -d ecommerce_test
```

Once PostgreSQL reports that it is accepting connections, run:

```sh
TEST_DATABASE_URL='postgresql://postgres:ecommerce-local-test@127.0.0.1:55432/ecommerce_test' npm test
docker stop ecommerce-store-postgres
```

## Run the API example

[examples/checkout.mjs](examples/checkout.mjs) exercises all 11 endpoints, including
cart edits, six purchases, coupon redemption, checkout retry, and reporting.
Use a fresh memory-mode server with database URLs unset:

```sh
COUPON_INTERVAL=5 DISCOUNT_PERCENT=10 npm run dev
```

In another terminal:

```sh
node examples/checkout.mjs
```

For another port, pass the base URL, for example
`node examples/checkout.mjs http://localhost:3001`. The expected report has six
orders, ₹675.00 gross revenue, ₹5.00 discounts, and ₹670.00 net revenue.
Restart the memory-mode server before repeating. For PostgreSQL, use a dedicated
fresh namespace with the default settings; the example changes its records.

## Vercel deployment

The Vercel project `ecommerce-store` is connected to
[cric2000/ecommerce-store](https://github.com/cric2000/ecommerce-store).
Committed changes pushed to `main` deploy automatically:

```sh
git push origin main
```

[vercel.json](vercel.json) installs dependencies, runs the default tests, checks
TypeScript, and builds the app. [app.mjs](app.mjs) serves the compiled Express app;
build/runtime results are available in Vercel's Deployments tab.

Production uses Vercel Hobby and the `ecommerce-store-db` Neon Free database in
`iad1`. The integration supplies `DATABASE_URL`, which is required on Vercel.
Automatic deployments are enabled for `main` only; preview deployments would
need separate database configuration.

## Design and documentation

Business rules live in `src/services/`, exact money arithmetic in `src/domain/`,
storage adapters in `src/store/`, and HTTP handlers in `src/routes/`. PostgreSQL
serializes writes through one snapshot row per namespace; this suits a small demo
and limits write throughput as the store grows.

- [API.md](API.md): full HTTP contract and errors.
- [DECISIONS.md](DECISIONS.md): design choices, invariants, limitations, and AI use.
- [AUDIT.md](AUDIT.md): requirement mapping and verification evidence.
- [ASSIGNMENT.md](ASSIGNMENT.md): original assignment requirements.
