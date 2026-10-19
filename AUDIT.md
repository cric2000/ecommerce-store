# Backend requirement audit

I compared every line of [ASSIGNMENT.md](ASSIGNMENT.md) with the source, tests,
API contract, and decisions. Adjacent or repeated requirements are grouped below;
the line references cover the complete assignment. Covered means implementation
or documentation evidence exists; executed check results are recorded separately.
Review and handoff items require my final review or submission actions.

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
- I updated the API error contract and removed the stale pending-audit status
  from the operational/design documents.

## Requirement evidence

| Assignment lines | Requirement | Evidence | Result |
| --- | --- | --- | --- |
| 1–6 | Backend scope, overlapping requests, prioritization | [DECISIONS.md](DECISIONS.md) records the focused in-memory design and deferrals; submission constraints remain part of final handoff. | Covered / handoff |
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
| 69–72 | Honest AI use, a real correction, further priorities, decision structure | [AI-use note](DECISIONS.md#actual-ai-use-and-human-review) records the rejected PORT guard; [further priorities](DECISIONS.md#first-priorities-with-another-two-hours) and all nine decision sections are present. | Covered |
| 73–74 | Meaningful commits and validated AI assistance | `git log --oneline --reverse` shows setup, domain, cart, checkout, concurrency, coupon, report, and documentation increments; checks are recorded below. | Covered / review |
| 75–81 | Ownership, explanation/debugging, no private transcripts | [DECISIONS.md](DECISIONS.md) explains invariants, transaction paths, weaknesses, configuration, and actual AI use. I still need to review and own every submitted change. No private transcripts are included. | Review |
| 82–89 | Evaluation criteria | The source/test evidence above addresses correctness, reasoning, failures, domain/API design, tests, and focused code. Quality and interview ownership remain human assessments. | Evidence / review |
| 90 | Optional frontend | The [browser demo](README.md#browser-demo) calls the backend for products, cart edits, coupon checkout, receipts, and reporting. Client/serving tests are in [demo-client.test.js](test/demo-client.test.js) and [demo-api.test.ts](test/demo-api.test.ts). | Implemented |
| 91–98 | Submission artifacts and final handoff | Source, run instructions, API/example, tests, and decisions are present. I still need to review/commit this audit and share a public or access-granted repository. Remote visibility/access has not been verified. | Handoff |

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

## Remaining limits and handoff

I found no additional missing required commerce behavior within the documented
single-process model. State is intentionally lost on restart; separate processes
do not coordinate. The complete deferral list and database/payment evolution are
in [DECISIONS.md](DECISIONS.md). Authentication, real payments, CI,
request logging, and deployment infrastructure remain outside this implementation.

The configured Git remote alone does not establish public or reviewer access.
Final review, committing these changes, and repository sharing remain pending.
