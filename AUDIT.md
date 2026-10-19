# Backend requirement audit

I compared every line of [ASSIGNMENT.md](ASSIGNMENT.md) with the source, tests,
API contract, and decisions. Adjacent or repeated requirements are grouped below;
the line references cover the complete assignment. Covered means implementation
or documentation evidence exists; executed check results are recorded separately.

## Findings and changes

- Malformed escapes in route parameters and damaged gzip bodies returned
  500 `INTERNAL_ERROR`.
  Express marks these decoding failures as 400, but the shared handler discarded
  that status. I reproduced both failures, then added a generic 400
  `INVALID_REQUEST` fallback after the specific error mappings. Unexpected
  exceptions still return a generic 500 without exposing private details.
- I added an explicit same-cart/different-key contention test. Existing tests
  covered matching retries and different carts competing for inventory; this
  test also checks that only the winning checkout key is bound.
- I updated the API error contract to document the decoding errors.

## Requirement evidence

| Assignment lines | Requirement | Evidence | Result |
| --- | --- | --- | --- |
| 1–6 | Backend scope, overlapping requests, prioritization | [DECISIONS.md](DECISIONS.md) records the focused in-memory design, priorities, and deferrals. | Covered |
| 7–8 | Product fields, five seeds, limited inventory | [types.ts](src/domain/types.ts), [seed.ts](src/store/seed.ts), and [carts.test.ts](test/carts.test.ts) verify five products and one single-stock product. | Covered |
| 9–10 | Multiple cart lines; reject invalid products/quantities | [carts.ts](src/services/carts.ts), [validation.ts](src/domain/validation.ts), [carts.test.ts](test/carts.test.ts), and [carts-api.test.ts](test/carts-api.test.ts). | Covered |
| 11 | Never oversell inventory | [orders.ts](src/services/orders.ts) validates under the store mutex; [checkout-concurrency.test.ts](test/checkout-concurrency.test.ts) and [orders-api.test.ts](test/orders-api.test.ts) compete for the last item. | Covered |
| 12–13 | Full cart lifecycle with prices/totals | [cart routes](src/routes/carts.ts), [cart service](src/services/carts.ts), and [HTTP lifecycle test](test/carts-api.test.ts) cover create/read/add/increment/update/remove. | Covered |
| 14 | A cart succeeds at checkout only once | [orders.ts](src/services/orders.ts) checks active status under the lock; [orders.test.ts](test/orders.test.ts) covers repeat checkout, and [checkout-concurrency.test.ts](test/checkout-concurrency.test.ts) covers different keys on one cart. | Covered |
| 15 | Price/availability change semantics | [DECISIONS.md](DECISIONS.md#decision-current-catalog-prices-and-immutable-orders), [carts.test.ts](test/carts.test.ts), and [orders.test.ts](test/orders.test.ts) cover current prices, reduced availability, and missing products. | Covered |
| 16–18 | Validated checkout, safe retries, competing requests | [orders.ts](src/services/orders.ts) stages one commit; [checkout-concurrency.test.ts](test/checkout-concurrency.test.ts) and [orders-api.test.ts](test/orders-api.test.ts) cover repeated/conflicting keys, failures, and stock contention. | Covered |
| 19 | Explainable order snapshots survive product changes | [Order type](src/domain/types.ts), [order retrieval](src/services/orders.ts), and [orders.test.ts](test/orders.test.ts) cover names/prices/quantities/calculations, detached receipts, and catalog changes/deletion. | Covered |
| 20 | Exact money arithmetic | [money.ts](src/domain/money.ts) uses bigint intermediates and safe numeric outputs; [money.test.ts](test/money.test.ts) covers decimal conversion, ties, overflow, and nonnegative totals. | Covered |
| 21 | Useful, distinguishable errors | [errors.ts](src/http/errors.ts), [API.md](API.md#error), and [carts-api.test.ts](test/carts-api.test.ts) cover business errors, malformed input/transport, and private exception masking. | Covered after fix |
| 22 | Payment semantics explained | [DECISIONS.md](DECISIONS.md#decision-successful-checkout-is-payment-success) treats successful placement as payment success; no gateway is required or called. | Covered |
| 23–25 | Configurable rewards and unique eligible milestones | [config.ts](src/config.ts), [coupons.ts](src/services/coupons.ts), [config.test.ts](test/config.test.ts), and [coupons.test.ts](test/coupons.test.ts) cover defaults/ranges, successful-order counts, backlogs, and concurrent generation. | Covered |
| 26–29 | Optional one-time coupon, failure preservation, competing redemption | [orders.ts](src/services/orders.ts), [coupons.test.ts](test/coupons.test.ts), and [coupons-api.test.ts](test/coupons-api.test.ts) cover valid/unknown/used coupons, atomic failure, and concurrent redemption/replay. | Covered |
| 30–31 | Deterministic nonnegative discounts and chosen semantics | [money.test.ts](test/money.test.ts), [coupons.test.ts](test/coupons.test.ts), and [DECISIONS.md](DECISIONS.md) cover subtotal half-up rounding, 100% discounts, shared codes, coexistence, and no stacking/expiry. | Covered |
| 32–33 | Administrative coupon generation | [coupon route](src/routes/coupons.ts), [API.md](API.md#post-admincoupons), and [coupons-api.test.ts](test/coupons-api.test.ts). | Covered |
| 34–40 | All required report quantities/revenues/coupon counts/order count | [AdminReport type](src/domain/types.ts), [reports.ts](src/services/reports.ts), and [reports.test.ts](test/reports.test.ts) verify every field against a mixed purchase history. | Covered |
| 41 | Report reconciliation and read-only behavior | [reports.test.ts](test/reports.test.ts) and [reports-api.test.ts](test/reports-api.test.ts) reconcile receipts/coupons and verify repeated reads, catalog independence, and complete committed states. | Covered |
| 42–48 | Every minimum API operation | [route files](src/routes/carts.ts), [API endpoint index](API.md#endpoint-index), and [checkout.mjs](examples/checkout.mjs) cover all required operations, plus health/catalog. | Covered |
| 49–50 | Endpoint contracts and administrative status | [API.md](API.md) documents methods, paths, bodies, response shapes, statuses, errors, and the two administrative routes without authentication. | Covered |
| 51–53 | In-memory overlap safety and multi-instance evolution | [mutex.ts](src/store/mutex.ts), [mutex.test.ts](test/mutex.test.ts), [checkout-concurrency.test.ts](test/checkout-concurrency.test.ts), and [DECISIONS.md](DECISIONS.md#evolution-to-multiple-instances-and-production-scale). | Covered |
| 54–57 | Source, repeatable setup/run/seed, no private application dependencies | [package.json](package.json), [package-lock.json](package-lock.json), [seed.ts](src/store/seed.ts), and [README.md](README.md) support a fresh local installation without credentials or a database. | Covered |
| 58–59 | Focused failure tests and meaningful contention/retries | [checkout-concurrency.test.ts](test/checkout-concurrency.test.ts), [orders-api.test.ts](test/orders-api.test.ts), and [coupons-api.test.ts](test/coupons-api.test.ts) include gated/service and competing HTTP requests. | Covered |
| 60–63 | Invariants, ambiguities, at least five material decisions | [DECISIONS.md](DECISIONS.md) contains invariants and nine decisions with context, alternatives, choice, reasons, and consequences. | Covered |
| 64–68 | Transactions/retries, money, errors, deferrals, production evolution | The corresponding sections in [DECISIONS.md](DECISIONS.md) match the staged checkout, shared lock, exact arithmetic, HTTP errors, and single-process limits. | Covered |
| 69–72 | Honest AI use, a real correction, further priorities, decision structure | [AI-use note](DECISIONS.md#actual-ai-use) records the rejected PORT guard; [further priorities](DECISIONS.md#first-priorities-with-another-two-hours) and all nine decision sections are present. | Covered |
| 73–74 | Meaningful commits and validated AI assistance | `git log --oneline --reverse` shows setup, domain, cart, checkout, concurrency, coupon, report, and documentation increments; checks are recorded below. | Covered |
| 75–81 | Explanation/debugging, actual AI use, no private transcripts | [DECISIONS.md](DECISIONS.md) explains invariants, transaction paths, weaknesses, configuration, and actual AI use. No private transcripts are included. | Documented |
| 82–89 | Evaluation criteria | The source/test evidence above addresses correctness, reasoning, failures, domain/API design, tests, and focused code. | Documented |
| 90 | Optional frontend | The [browser demo](README.md#browser-demo) calls the backend for products, cart edits, coupon checkout, receipts, and reporting. Client/serving tests are in [demo-client.test.js](test/demo-client.test.js) and [demo-api.test.ts](test/demo-api.test.ts). | Implemented |
| 91–98 | Repository contents | Source, run instructions, API/example, tests, and decisions are present. Public repository access and the remote implementation commit were verified during final acceptance below. | Verified |

## Final acceptance verification

I checked implementation commit `c3a1b6cc976f08f3ed339a35b99e7fdd6489eda4`
(`feat: add interactive Swagger API documentation`). I compared the assignment
and planned acceptance checklist with the source, tests, API contract, and decisions. I found no missing
required commerce behavior within the documented single-process model.

| Acceptance item | Evidence | Result |
| --- | --- | --- |
| Five seeded products, including limited inventory | [seed.ts](src/store/seed.ts), catalog/cart tests, and fresh HTTP checks confirm five seeds and one desk lamp. | Passed |
| Invalid products and quantities are rejected | [carts.test.ts](test/carts.test.ts), [validation.test.ts](test/validation.test.ts), and [carts-api.test.ts](test/carts-api.test.ts) cover missing products, invalid quantities, unknown properties, and unchanged state after failure. | Passed |
| Competing checkouts cannot oversell | [checkout-concurrency.test.ts](test/checkout-concurrency.test.ts) and [orders-api.test.ts](test/orders-api.test.ts) compete for the last item. | Passed |
| Full cart lifecycle and useful totals | [carts-api.test.ts](test/carts-api.test.ts) and the executable API example cover create/read/add/increment/update/remove and paise totals. | Passed |
| Price and availability changes have defined behavior | [carts.test.ts](test/carts.test.ts), [orders.test.ts](test/orders.test.ts), and [DECISIONS.md](DECISIONS.md#decision-current-catalog-prices-and-immutable-orders) verify current prices/stock and preserved quantities. | Passed |
| A cart can succeed at checkout only once | [orders.test.ts](test/orders.test.ts) and [checkout-concurrency.test.ts](test/checkout-concurrency.test.ts) cover closed carts and competing different keys for one cart. | Passed |
| Retries do not duplicate orders or deductions | Service and HTTP concurrency tests cover matching replay, conflicting key reuse, unbound failed attempts, and replay before live-state validation. | Passed |
| Order snapshots survive catalog changes | [orders.test.ts](test/orders.test.ts) covers changed/deleted products and detached receipts. | Passed |
| Exact money and documented rounding | [money.test.ts](test/money.test.ts) covers bigint intermediates, safe boundaries, and half-up rounding; [DECISIONS.md](DECISIONS.md#decision-integer-paise-and-half-up-percentage-rounding) records the formula. | Passed |
| Useful, distinguishable errors | HTTP tests cover validation, malformed JSON/URLs, damaged compression, missing resources, conflicts, media/body limits, unsafe amounts, and generic unexpected failures. | Passed |
| Coupons require reached milestones and cannot duplicate one | [coupons.test.ts](test/coupons.test.ts) and [coupons-api.test.ts](test/coupons-api.test.ts) cover success-only eligibility, backlog, competing generation, and redeemed milestones. | Passed |
| Coupon use is single-use, concurrent-safe, and preserved on failure | Coupon tests cover competing redemption, matching replay, and stock/arithmetic failures without consuming a coupon. | Passed |
| Discounts are deterministic and totals nonnegative | Money/coupon tests cover half-up ties, zero-priced items, and 100% discounts. | Passed |
| Reports contain every field, reconcile, and are read-only | [reports.test.ts](test/reports.test.ts), [reports-api.test.ts](test/reports-api.test.ts), and the executable example reconcile receipts, quantities, revenue, discounts, and coupons. | Passed |
| Every required API operation is documented | [API.md](API.md), `/docs`, and `/docs/openapi.json` cover 11 operations; [docs-api.test.ts](test/docs-api.test.ts) validates OpenAPI and compares operation coverage. | Passed |
| Single-process limits and production evolution are explained | [DECISIONS.md](DECISIONS.md#evolution-to-multiple-instances-and-production-scale) records database transactions, constraints, locks, durable keys, and payment recovery. | Verified |
| Focused tests exercise meaningful failures and competing/repeated operations | The fresh suite passed 231 tests across 17 files, including service gates and competing HTTP requests. | Passed |
| DECISIONS.md covers all required topics and matches the implementation | Nine structured decisions, invariants, selected ambiguities, deferrals, concurrency/retries, money/errors, actual AI use with a correction, and further priorities are present. | Verified |
| Setup, run, seed, and checks need no private application service | Fresh locked installation, development and compiled startup, automatic seeds, syntax checks, and the API example passed. Lockfile downloads use the public npm registry. | Passed |
| Meaningful commit history | History records tooling, decisions, domain/cart/checkout/concurrency/coupon/report work, audit fixes, frontend, and Swagger documentation as focused increments. | Verified |
| Public repository contains the checked implementation | GitHub reports [cric2000/ecommerce-store](https://github.com/cric2000/ecommerce-store) as PUBLIC; remote `main` matched the checked commit. | Verified |
| Implementation explanations | The source and decisions identify enforcement paths, retry/concurrency behavior, weaknesses, and configurable reward rules. | Documented |

### Executed checks

I extracted the tracked files from the checked commit into a fresh temporary
directory, without copying `node_modules`, `dist`, ignored environment files, or
Git metadata. Node.js was 24.21.0 and npm was 11.19.0.

| Command/check | Actual result |
| --- | --- |
| `npm ci --cache /tmp/ecommerce-store-npm-cache` | Installed locked dependencies successfully; npm audit reported zero vulnerabilities. |
| `npm test` | All 231 tests passed across 17 files, including HTTP and OpenAPI checks. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |
| `node --check public/app.js` | Passed. |
| `node --check public/client.js` | Passed. |
| `node --check examples/checkout.mjs` | Passed. |
| `PORT=3116 COUPON_INTERVAL=5 DISCOUNT_PERCENT=10 npm start` | Fresh compiled server started. |
| `node examples/checkout.mjs http://localhost:3116` | Passed every API operation, six orders, coupon redemption, checkout replay, stock, and repeated reports. |
| Compiled HTTP asset/contract checks | Demo and Swagger pages/assets returned 200; the served 11-operation OpenAPI document validated; private/package paths returned structured 404s; reads left the report unchanged. |
| Restart with `PORT=3116 COUPON_INTERVAL=5 DISCOUNT_PERCENT=10 npm run dev` | Development startup, health, demo, and Swagger passed; five original seeds/inventory and an empty order/coupon report confirmed the documented reset. |
| Local documentation checks | All local file links/anchors, nine JSON examples, nine structured decisions, and all 98 assignment lines validated. |
| `git diff --check` | Passed after the final documentation update. |
| GitHub read-only checks | Repository visibility was PUBLIC and remote `main` matched `c3a1b6cc976f08f3ed339a35b99e7fdd6489eda4`. |

The API example produced gross revenue 67500 paise, discounts 500, net revenue
67000, six orders, and one generated/redeemed coupon. I stopped both temporary
verification servers afterward.

## Backend audit verification

These results record the backend audit before the optional frontend was added.

I verified the working source in a fresh directory without copying `node_modules`,
`dist`, or ignored environment files. Node.js was 24.21.0 and npm was 11.19.0.
The install used the lockfile and a writable npm download cache.

| Command/check | Actual result |
| --- | --- |
| `npm ci --cache /tmp/ecommerce-store-npm-cache` | Installed successfully; npm audit reported zero vulnerabilities. |
| `npm test` | 214 tests passed across 14 files. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |
| `node --check examples/checkout.mjs` | Passed. |
| `PORT=3110 COUPON_INTERVAL=5 DISCOUNT_PERCENT=10 npm start` | Compiled server started successfully. |
| `node examples/checkout.mjs http://localhost:3110` | Passed every endpoint, cart edits, six orders, redemption/replay, stock, and report assertions. |
| `git diff --check` in the working repository | Passed. |
| Local documentation validation | Checked links/anchors, nine JSON examples, eleven endpoint sections, twenty error codes, all 98 assignment lines, and nine structured decisions. |

The walkthrough reported gross revenue 67500 paise, discounts 500, net revenue
67000, and one generated/redeemed coupon. The server was stopped afterward.
The two new decoding regressions first failed with 500 responses, then passed
after the fix. The sandbox initially blocked loopback HTTP tests; permitted
reruns passed. The earlier operational review also verified development startup
and the same walkthrough with `npm run dev`.

## Swagger documentation verification

I added interactive documentation at `/docs` and `/docs/`, with the OpenAPI
document at `/docs/openapi.json`. The specification describes all 11 existing
operations and uses the current origin for requests. Swagger UI assets are served
from the installed package; no CDN or external validator is used by the page.

`npm test` passed all 231 tests across 17 files. The new documentation checks
validate the served OpenAPI structure and references, compare endpoint coverage
with API.md, verify local asset serving, and execute documented request examples,
including missing-key rejection and matching checkout replay. `npm run typecheck`,
`npm run build`, and `git diff --check` passed. The initial sandboxed HTTP run
could not bind loopback ports; the permitted rerun passed.

Using `PORT=3115 COUPON_INTERVAL=1 DISCOUNT_PERCENT=10 npm start`, I verified the
Swagger page in the browser and executed cart creation, item addition, checkout,
and matching checkout replay through **Try it out**. The retry returned the same
order and Location. No browser console warnings or errors were reported. These
requests changed only that verification server's in-memory store.

## Browser demo verification

After adding and refining the optional frontend, I ran `npm test`: all 228 tests passed across
16 files, including the existing backend checks and the new browser-client and
static-serving tests. `npm run typecheck`, `npm run build`,
`node --check public/app.js`, `node --check public/client.js`, and
`git diff --check` passed.

I ran the browser walkthrough against
`PORT=3111 COUPON_INTERVAL=2 DISCOUNT_PERCENT=10 npm run dev`: cart creation,
addition, quantity update/removal, insufficient-stock and invalid-coupon errors,
milestone eligibility, three purchases, coupon generation/redemption, order
receipts, repeated reports, and product quantities. The final report showed
34900 paise gross, 1990 discounts, 32910 net, three orders, and one redeemed
coupon. Browser checks at widths 1280 and 390 confirmed the desktop/mobile
layouts without horizontal overflow. No browser console errors or warnings
were reported. Uncertain checkout key reuse is covered by client tests.

I also ran `PORT=3112 COUPON_INTERVAL=5 DISCOUNT_PERCENT=10 npm start` after
building. The demo HTML, JavaScript modules, and stylesheet returned HTTP 200.
`node examples/checkout.mjs http://localhost:3112` passed its existing six-order
API walkthrough. No dependency or package-script changes were needed.

For the notification/coupon refinements I used port 3113 with interval 1 and
discount 10. I verified plain-language errors in a fixed, dismissible banner
while scrolled down, including the mobile layout. Clipboard copy/paste matched
the exact coupon code. Applying an available coupon after checkout automatically
created a cart and filled in the code; redemption then disabled the button with
the label Already used. No browser console errors or warnings were reported.

Using the compiled server on port 3114, I verified the purchase summary displays
catalog names instead of product IDs. Failed checkout preserved cart items;
successful checkout cleared the cart panel and coupon input while preserving
the saved receipt. Refreshing kept the cart empty, and the next purchase used
only newly added items. These checks covered checkout with and without a coupon.

The browser keeps its current cart, receipt, latest coupon, and uncertain retry
key only while the page remains open. Reload recovery/history is outside this
small demo. Server state and the single-process limitations remain unchanged.

## Documented limitations

I found no additional missing required commerce behavior within the documented
single-process model. State is intentionally lost on restart; separate processes
do not coordinate. The complete deferral list and database/payment evolution are
in [DECISIONS.md](DECISIONS.md). Authentication, real payments, CI,
request logging, and deployment infrastructure remain outside this implementation.
