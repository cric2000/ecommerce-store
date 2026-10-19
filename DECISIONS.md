# Design decisions

## Status and scope

This document records the implemented backend contract and deferred concerns.
Project tooling, application/server entry points, `GET /health`, domain types,
quantity/money validation, exact money helpers, seeded catalog, cart lifecycle,
JSON errors, checkout with optional coupons, order retrieval, coupon generation,
shared mutation locking, idempotent replay, and read-only reporting are
implemented. API/operational review and the final backend audit are complete.
The requirement comparison and verification evidence are in [AUDIT.md](AUDIT.md).
The decisions below describe the implementation and deferred concerns. See
[API.md](API.md) for the HTTP contract.

The design keeps a focused single-process service with routes, services, domain
types, and an in-memory store. It prioritizes correctness, invariants, focused
tests, and clean architecture over optional features.

## System invariants

- Product inventory is a nonnegative safe integer. A successful checkout deducts
  exactly the purchased quantities and cannot oversell.
- A cart contains at most one entry per product; quantities are positive safe
  integers. Invalid products/quantities never enter the cart.
- Adding to a cart does not reserve inventory. Cart views and checkout use current
  catalog prices; checkout rechecks current availability.
- A cart transitions from `active` to `checked_out` at most once. Checked-out carts
  remain readable but cannot be edited or used for another order.
- An order is an immutable purchase snapshot: product IDs/names, quantities, unit
  prices, line totals, subtotal, coupon details, discount, final total, and currency.
- Replaying a successful checkout with the same key and request returns the
  original order. A successful key cannot be rebound to a different request.
- Checkout commits the order, inventory, cart status, coupon redemption, and
  successful idempotency record together. Failure before commit changes none of
  them; a lost response after commit is recovered by replaying the successful key.
- Only successfully placed orders count toward coupon milestones. Each positive
  multiple of `n` permits at most one generated coupon.
- A coupon is available or redeemed; redemption references one successful order.
  One order uses at most one coupon, and concurrent checkouts cannot redeem the
  same coupon twice.
- Monetary values are nonnegative safe integer paise. Subtotal minus discount
  equals final total; deterministic rounding never produces a negative total.
- Reports are read-only derivations of completed orders and coupon records.
  Gross revenue minus discounts equals net revenue; generated coupons equal
  available plus redeemed coupons.

## Decision: Current catalog prices and immutable orders

**Context:** Prices and availability may change between adding items and checkout.

**Options considered:** Reserve price/stock when adding; reject checkout whenever
the cart's original price changes; or use current prices and revalidate stock.

**Choice:** Use current catalog prices when reading a cart and when checking out.
Check stock on add/update without reserving it. Checkout checks it again. Save an
immutable order snapshot using the prices accepted at checkout.

**Why:** This avoids reservation expiry and stale-price state, while making the
cart useful and orders explainable later.

**Consequences:** A previously valid cart can become unpurchasable or cost more.
Views retain requested quantities even if stock falls; each line exposes current
inventory and `isAvailable`, and totals still use current prices. Price changes
need no separate client confirmation in this assignment. Products have no delete
API; if a referenced product is nevertheless missing, cart reads/checkout return
`PRODUCT_NOT_FOUND` rather than inventing a price. Old orders never read prices
or names back from the catalog.

## Decision: One in-memory mutation lock and a staged commit

**Context:** Overlapping operations must not oversell, edit a cart during checkout,
double-checkout a cart, or redeem/generate a coupon twice.

**Options considered:** Rely on the event loop alone; use per-product/per-coupon
locks; use one process-wide lock; or introduce a database transaction immediately.

**Choice:** Use one asynchronous FIFO mutex owned by the store and shared by all
services in that app instance. All state mutations, including cart edits and
admin coupon generation, use it. For checkout: validate, calculate, and prepare
new records/maps without mutating live records, then publish the prepared state
with one synchronous state-reference replacement. Release the mutex in `finally`.

**Why:** One lock avoids lock ordering/deadlocks and keeps transaction boundaries
visible. Preparing before publication prevents validation/calculation errors from
leaving a partly updated order, coupon, cart, or stock count.

**Consequences:** Writes are serialized, limiting throughput. Do not await network
work inside the critical section. Reads build detached responses synchronously
from one captured state reference; callers never receive mutable store objects.
No custom transaction framework is needed: copying the small affected maps and
records is sufficient. A process crash loses all in-memory state. This lock
coordinates neither multiple processes nor multiple application instances.

**Implementation status:** The store owns a FIFO promise-based mutex. All cart
mutations, checkout, and coupon generation acquire it before capturing state. Each queued operation
waits for its predecessor; `finally` releases the next waiter after either success
or failure. Cart mutation/checkout service methods now return promises, and routes
await them. Never call another lock-taking service method from inside the lock;
this small mutex is not reentrant.

Checkout captures one state, checks successful keys before live cart/inventory/
coupon validation, builds purchase snapshots, and prepares new product/cart/order/
key/coupon maps plus a detached response. One state-reference assignment commits everything.
Validation/arithmetic failure saves nothing, including deductions prepared for
earlier lines. Current critical-section work has no external I/O. Reads remain
synchronous and return detached records from one state; order reads never consult
current catalog data. Tests hold the lock across an explicit gate to prove that
checkout and edits wait, and verify that checkout reads stock after acquiring it.
Store state remains a trusted internal dependency, not an object exposed over HTTP.
This coordinates one shared store in one process, not independent app instances.

## Decision: Checkout keys bind successful requests

**Context:** A client may lose a response and retry; cart status alone would
prevent another order but would not return the original successful result.

**Options considered:** Use only cart status; cache all responses including errors;
or require a key and remember successful checkout results only.

**Choice:** Require `Idempotency-Key` for checkout. Keys are global within the store.
The request identity is the validated cart ID and optional coupon code, normalized
to `{ cartId, couponCode: codeOrNull }`. JSON whitespace/property order do not
affect identity. Check the key inside the same mutation lock before checking
cart status or current inventory. An identical successful replay returns the
original HTTP 201, order body, and Location. A different identity returns
`IDEMPOTENCY_KEY_CONFLICT` (409).

**Why:** Replays explain a successful purchase even after the cart is closed or
the catalog changes, and concurrent retries cannot both create orders.

**Consequences:** A fresh key for a checked-out cart returns `CART_ALREADY_CHECKED_OUT`.
Failures create no binding/cache entry, so a client may fix the cart and retry
with the same key. Cart contents are not part of the request fingerprint: before
success, the request always acts on the cart's current contents. Successful keys
remain until process restart; no expiry/cleanup is implemented. A restart loses
keys and orders together. Clients cannot rely on durability across restarts.

**Current identity:** A key record stores the validated cart ID, optional coupon
code normalized to null when absent, and immutable order ID. Code matching is
exact; explicit null/blank/array codes are invalid input, not absence. Adding,
removing, or changing a coupon on a successful key conflicts, as does changing
the cart. JSON formatting does not change identity. Checkout returns a detached
copy of the saved order and reconstructs its original 201 and Location before
checking live coupon status. Thus an already-redeemed coupon can be replayed only
as part of its original successful request. Key records commit with all purchase
changes. Missing/repeated/malformed keys return `INVALID_IDEMPOTENCY_KEY` (400);
different valid request identity returns `IDEMPOTENCY_KEY_CONFLICT` (409).

## Decision: Explicit generation for each order milestone

**Context:** The assignment permits admin-requested generation but leaves the
handling of multiple eligible milestones and coupon ownership unspecified.

**Options considered:** Automatically generate during checkout; allow only the
latest milestone; generate all outstanding coupons at once; or generate one
oldest outstanding milestone per administrative request.

**Choice:** Configure `COUPON_INTERVAL` (`n`, default 5, positive safe integer) and
`DISCOUNT_PERCENT` (`x`, default 10, integer 1–100) at startup. Treat invalid
business configuration as a startup error. Milestones are successful order counts
`n`, `2n`, `3n`, etc. `POST /admin/coupons` generates one coupon for the oldest
eligible milestone with no coupon record. Eligibility means that milestone is
at most the current successfully placed order count. Use the same mutation lock
as checkout and record the milestone on the coupon.

**Why:** Delayed admin calls do not forfeit earned milestones, and each call has
a small, predictable result.

**Consequences:** For `n = 5` and 12 orders, two generation calls can issue coupons
for 5 and 10. A third returns `NO_ELIGIBLE_MILESTONE` (409). Redeeming a coupon
does not make its milestone eligible again. Concurrent generation may issue
different outstanding milestones, never the same milestone. This endpoint has
no idempotency key: retrying after a lost response may issue the next outstanding
coupon. That is an intentional limit of admin retry behavior. Configuration
remains fixed for the store's lifetime. Coupons snapshot their discount percent.
`src/config.ts` parses startup environment values and validates their ranges.
`createApp()` uses those settings; injected stores can specify settings for tests.
The store validates, copies, and freezes settings so outside mutation cannot
change milestone spacing or coupon percentages while it runs. Environment values
must contain decimal digits only, and invalid configuration fails before listening.
Generation scans existing coupon records, including redeemed ones, and compares
each milestone with `orders.size`; no separate reward/order counter exists.

## Decision: Shared, single-use coupons applied atomically

**Context:** There is no customer identity/authentication, and a failed checkout
must leave a coupon available.

**Options considered:** Assign coupons to customers; expire coupons automatically;
consume before checkout validation and compensate on failure; or keep shared
coupons and redeem in the checkout commit.

**Choice:** Coupons are opaque, case-sensitive codes, usable by any cart, with no
expiry. Multiple milestones' coupons can remain available together. Checkout
accepts at most one code, discounts the entire subtotal, and rejects an invalid
or already-redeemed coupon. Validate and stage redemption together with the order
and inventory, under the shared lock; mark redeemed only in the successful commit.

**Why:** This meets the stated one-time and failure requirements without inventing
customer accounts, expiry jobs, or compensation logic.

**Consequences:** Anyone who knows a code can redeem it. A coupon earned by one
checkout can only be generated and used afterward, not retroactively on that
same order. An invalid coupon fails checkout rather than silently charging full
price. A 100% coupon creates a valid zero-total successful order and counts toward
later milestones. No stacking, customer ownership, refunds, or coupon reversal.

## Decision: Integer paise and half-up percentage rounding

**Context:** Binary floating point can introduce rounding differences in money.

**Options considered:** Floating-point rupees; a decimal library; integer paise
with floor rounding; or integer paise with half-up rounding.

**Choice:** Use INR and integer paise in storage and HTTP responses. Unit price,
quantity, line total, subtotal, discount, final total, and report amounts must
fit within `Number.MAX_SAFE_INTEGER`. Use `bigint` intermediates for multiplication,
summation, and percentage rounding; check the range before returning a number.
For subtotal `s` and integer percentage `p`, the discount is:

```text
discount = (BigInt(s) * BigInt(p) + 50n) / 100n
total = BigInt(s) - discount
```

Both results above are `bigint`; range-check before converting to numeric paise.
Divide using integer division; apply the coupon once to the subtotal, not each
line. Restrict `p` to 1–100. Any rupee conversion helper parses decimal strings
with at most two fractional digits (e.g. `"12.34"` becomes 1234), rejecting
negative, excessive-precision, or out-of-range values rather than multiplying a
floating-point value by 100. No API accepts prices from clients.

**Why:** This is exact, dependency-free arithmetic with an explicit tie rule.
For 105 paise at 10%, the discount is 11 paise and the final total is 94 paise.

**Consequences:** Fractions below one paise are rounded once. Reject an operation
whose calculated amount exceeds the supported range with `AMOUNT_OUT_OF_RANGE`
(422), before mutation. Quantities must also be positive safe integers; zero
means invalid input, not item removal. Report accumulation uses exact
intermediates too and reports a range error if a monetary total or purchased
quantity aggregate would be unsafe.

The implemented helpers in `src/domain/money.ts` cover decimal-string conversion
in both directions, line multiplication, sums, percentage discounts, and final
totals. Input conversion accepts whole rupees or one/two fractional digits;
leading zeros are allowed. Whitespace, signs, exponents, missing whole digits,
and excessive decimal precision return `INVALID_REQUEST`. Unsafe monetary inputs
or calculated values return `AMOUNT_OUT_OF_RANGE`; a discount larger than the
subtotal is rejected rather than clamped. When no coupon is applied, the
discount is zero; an actual percentage must be 1–100.

## Decision: Successful checkout is payment success

**Context:** The assignment requires no real payment integration.

**Options considered:** A fake gateway with payment states/failure simulation; or
an order placed successfully in the local transaction counts as paid.

**Choice:** Successful checkout creates an order with status `placed` and is
treated as payment success. There is no payment call or separate payment state.

**Why:** A fake gateway would add states unrelated to the required invariants.

**Consequences:** No money is actually charged. Orders, inventory, and coupon
redemption share one local commit. A future gateway would require a durable
payment/order state machine, gateway idempotency, and recovery for uncertain
outcomes; a local mutex cannot make an external payment atomic.

## Decision: Structured errors and small HTTP handlers

**Context:** Clients need to distinguish bad input, missing resources, and state
conflicts without parsing human messages.

**Options considered:** Plain strings; generic 400 responses; or stable error
codes with a small shared JSON envelope.

**Choice:** Return `{ "error": { "code": "...", "message": "..." } }`, with optional
structured `details`. Use 400 for malformed/invalid input, 404 for missing
resources, 409 for state conflicts, 413 for oversized JSON bodies, 415 for
unsupported request content types/charsets/encodings, 422 for unsafe calculated
money or report quantity ranges, and 500 for unexpected errors.
Keep validation/business rules in services/domain helpers; routes translate HTTP
input and results. A shared error handler serializes known errors and hides
internal exception details for unexpected failures. See API.md for precise codes.

**Why:** Codes make failures usable in tests and client behavior without a large
error hierarchy or a new validation framework.

**Consequences:** Request shapes are strict: reject unknown body properties,
numeric strings, invalid quantities, and malformed coupon/key values. Body
validation happens before entering the transaction; successful key lookup happens
before live-state validation. Do not promise which of several independent
business failures wins. Authentication is intentionally absent; administrative
routes are identified with `/admin` and in the contract, not access-protected.

## Decision: Derive reports from purchase records

**Context:** Incremental counters can drift or be accidentally changed by reads.

**Options considered:** Maintain running report counters on every write; or
recalculate reports from immutable orders and coupon state.

**Choice:** Read one captured store state synchronously. Sum quantities by product
ID from order lines, gross revenue from order subtotals, discounts from order
discounts, and net revenue from order totals. Count successfully placed orders
and generated/available/redeemed coupon records directly. Include only products
with purchases, sorted by product ID for stable output. No counter is updated
by reporting. An empty store returns empty purchased quantities and zero totals.

**Why:** This is easy to reconcile and test at assignment scale.

**Consequences:** Each report scans all orders/coupons and may get expensive as
history grows. No returns or cancellations adjust these figures in this scope.
Product names are deliberately absent from quantity aggregates because names
can change; product IDs remain the aggregation key.

**Implementation:** `ReportService.getReport()` captures the state once and runs
synchronously without taking the mutation lock or writing to the store. Existing
money helpers sum stored subtotals, discounts, and totals with exact intermediates.
Per-product quantities accumulate as `bigint` before range-checked numeric output.
Unsafe aggregates return `AMOUNT_OUT_OF_RANGE` (422) without changing state. The
store contains only placed orders; unsuccessful attempts create no order record,
and successful retries return an existing record. Reports return fresh arrays and
objects, so changing a returned report cannot alter service state. A read while
checkout is queued sees the previous committed state; later reads see the complete
new state, including coupon redemption and the discounted order together.

## Implemented scope, deferrals, and validation

**Implemented now:** Express health route; separate app/server; strict TypeScript;
Vitest HTTP health test; npm scripts/lockfile; installation/run instructions; this
design and the API contract; domain types for products, stored carts,
current-price cart views, coupons, order snapshots, and reports; shared domain
errors and quantity/percentage/paise validators; exact money helpers and focused
tests for their validation, rounding, and range boundaries.

The service includes five seeded products (including one with inventory of one),
a per-app in-memory store, catalog/cart services and routes, strict request object checks,
and common HTTP error responses. Cart tests exercise full edits, stock checks
without reservations, current price/availability changes, missing products,
failed-write preservation, detached responses, and request/response contracts.
Express's existing 100 KiB JSON parser limit returns a structured 413 error.

Checkout supports optional coupons and order retrieval. Checkout revalidates
stored quantities and unique product lines, current catalog data, and stock;
stores an order snapshot; reduces inventory; and closes the cart in one staged
state replacement. Tests cover failed checkout preserving all state, repeat
checkout rejection, zero-total purchases, arithmetic overflow, detached receipts,
and snapshots surviving catalog changes/deletion. Success means payment success
without an actual payment integration.

The shared mutex and successful checkout key records coordinate writes. Service
and HTTP tests cover last-item contention, simultaneous identical retries, conflicting key
reuse, failed attempts leaving keys available, and replay after catalog deletion.
Mutex tests check FIFO ordering, exclusion across an await, and release after both
synchronous and asynchronous failures. Cart/order tests await mutations and use
`.rejects.toThrow()` for their errors.

Fixed reward configuration, admin coupon generation, and optional checkout coupons
are implemented. Available/redeemed coupon state, the applied discount snapshot,
and the optional code in request identity participate in the locked
commit. Tests cover reached/duplicate/backlogged milestones, concurrent generation,
coexisting coupons, failed stock/money validation preserving available coupons,
competing redemption, matching replay, changed-code conflicts, half-up rounding,
and zero-total successful purchases. Generation also waits for a queued checkout
and reads its newly reached milestone under the same lock.

The read-only admin report has service/HTTP tests for quantities,
revenue, discounts, coupon counts, and placed-order counts. Tests reconcile a
mixed purchase history against receipts/coupon records, repeat reads while a
coupon milestone is eligible, check detached responses, and verify independence
from catalog changes. They also cover failures/replays/active carts, zero-total
orders, safe-integer boundaries for revenue and quantities, and reads around a
queued checkout. No report counters or generation side effects are added.

`Paise` is a number alias rather than a branded type. Runtime helpers validate
its range and integer rules. Domain properties/arrays are `readonly`, and cart
and coupon types link each status to its nullable/non-null order ID. These
compile-time safeguards do not freeze objects, validate raw JSON, or implement
store transactions. Stored cart items contain IDs/quantities; current prices
belong to cart views and purchase prices belong to order snapshots. Domain errors
carry codes/messages/details only; HTTP status mapping and shared Express error
handling now live separately in `src/http/errors.ts`.

The API review covers each endpoint's method, path, request/response, status,
important errors, and administrative status. The executable example in
`examples/checkout.mjs` calls every endpoint, checks cart edits and order receipts,
redeems a milestone coupon, replays checkout, and verifies the final report and
stock. It requires a fresh seeded server with interval 5 and discount 10;
README.md explains its state changes and expected results.

HTTP regression checks distinguish unsupported JSON charsets/content encodings
(415) from malformed JSON (400), oversized bodies (413), and unexpected service
failures (500). Unexpected exceptions receive a generic message without private
details. The parser review exposed unsupported charset/encoding errors becoming
500 responses; these now use the existing `UNSUPPORTED_MEDIA_TYPE` code.
The final audit also exposed malformed URL escapes and damaged compressed bodies
becoming 500 responses. The handler now preserves Express's 400 classification as
`INVALID_REQUEST` after the more specific mappings; its generic message contains
no parser internals. HTTP regression tests reproduce both cases and verify that
normal requests still work afterward. Same-cart checkouts with different keys
also have an explicit contention test, including which key becomes bound.

**Operational verification:** I verified a fresh source copy without existing
`node_modules` or `dist`, using Node.js 24.21.0 and npm 11.19.0. Locked installation
with `npm ci` (using a writable npm package cache), all 214 tests,
`npm run typecheck`, and `npm run build` passed. The executable example passed
against the compiled server using `npm start`, port 3110, interval 5, and discount
10. It checked all endpoints, six orders, gross revenue 67500 paise, discounts
500, net revenue 67000, and one redeemed coupon. The earlier operational review
also verified the example against `npm run dev` and confirmed that restarting
restores the seed and empty state. [AUDIT.md](AUDIT.md#verification) records the
final commands and results.

**Final backend audit:** I compared every assignment line with source, tests, and
documentation. [AUDIT.md](AUDIT.md) records the evidence, concrete fixes, executed
checks, and remaining handoff items. No additional missing required commerce
behavior was found within the single-process model. No multi-instance coordination
or completed submission is claimed.

**Intentionally deferred:** Persistence/restart recovery, multi-instance
coordination, authentication/authorization, real payments, reservations, coupon
ownership/expiry/stacking, taxes/shipping, refunds/cancellations, pagination,
idempotency retention policies, deployment infrastructure, and load testing.
Request logging and CI are also deferred to keep this service focused on the
required behavior and local evaluation commands. A frontend is optional and only
considered after backend requirements are sound.

**Submission still pending:** Review and commit the remaining changes, and share
a public or access-granted repository containing source, tests, API documentation,
run instructions, and this decisions document. No hosted repository or completed
submission is claimed here.

## Evolution to multiple instances and production scale

Move carts, catalog/inventory, orders/lines, coupons, milestones, and idempotency
records to a durable database. Place checkout validation and all writes in one
database transaction. Lock inventory rows in a consistent product-ID order or
use conditional stock decrements and verify affected rows. Serialize cart
checkout and coupon redemption with row locks/conditional updates. Use unique
constraints for order cart IDs, coupon milestones, and idempotency keys so
separate application processes cannot both succeed. Store the request identity
and successful response in the same transaction. On a duplicate key, read the
committed result and compare identity; retry documented transaction conflicts.

Replace the order-count-derived milestone race with a transactional counter or
equivalent serialized milestone allocation, while keeping report reconciliation
against orders. Add persistence/recovery, authentication and admin authorization,
bounded requests, idempotency retention rules, pagination, observability, and
capacity tests according to actual usage. Production reports can use database
aggregations and eventually maintained summaries with reconciliation checks.
Introduce external payments only with durable states and recovery, as described
above. None of these production properties comes from the in-process mutex.

## Actual AI use and human review

I used Codex to scaffold the project tooling, Express app, and health test; draft
the design/API documentation; and implement the domain types, validation, money
helpers, seeded catalog, cart/checkout/order services and routes, the shared
mutex, checkout retry handling, coupon configuration/generation/redemption,
administrative reporting, and focused tests. I also used it for the API/operational
documentation review, executable API example, and parser error regression fix,
the final requirement audit and decoding-error fix, and to run real HTTP requests
and service/domain checks.
Sandbox restrictions required permitted reruns of dependency installation and
local HTTP tests. The current tests cover single-process stock, retries, and
coupon/report behavior; they do not establish multi-instance coordination.

The initial generated server included explicit validation of the `PORT`
environment variable in `src/server.ts`. I rejected that defensive check as
unnecessary for this app and removed it. I also added the comment explaining
port 0 in the health test. Both edits remain in place. This correction illustrates
keeping scope proportionate rather than accepting every generated guard. It does
not mean business input validation or coupon configuration validation should be
omitted.

I review and commit each task and remain responsible for every submitted line
and for explaining or modifying it. This account records actual AI assistance,
including the correction above, without private transcripts.

## First priorities with another two hours

After finishing the required backend, I would first examine the
transaction/idempotency boundary with failure-injection and coordinated competing
HTTP requests: missing responses, repeated keys with different identities, coupon
contention, and state unchanged after each failure. I would next verify
arithmetic/report reconciliation at rounding and safe-integer boundaries, then
assess a durable database transaction design and crash/restart behavior. I would
prioritize these over a larger frontend or deployment setup, adjusting priorities
based on audit gaps.
