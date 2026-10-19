# Design decisions

## Status and scope

This document records the proposed contract for the remaining backend tasks.
Only project tooling, application/server entry points, and `GET /health` are
implemented. Task 2 adds documentation, not business logic. The invariants and
strategies below are design commitments to implement and test, not claims that
the current service enforces them. See [API.md](API.md) for the HTTP contract.

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

**Why:** This avoids reservation expiry and stale-price state within the timebox,
while making the cart useful and orders explainable later.

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
resources, 409 for state conflicts, 415 for unsupported request content types,
422 for unsupported calculated money ranges, and 500 for unexpected errors.
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

## Planned scope, deferrals, and validation

**Implemented now:** Express health route; separate app/server; strict TypeScript;
Vitest HTTP health test; npm scripts/lockfile; installation/run instructions; this
design and the planned API contract.

**Required and pending:** Domain types, input validation and money helpers; at
least five seeded products including limited inventory; full cart lifecycle;
order snapshots; locked checkout; retry handling; configurable coupon milestones,
generation/redemption; reconciled admin reports; business/API tests; final
documentation and assignment audit. In particular, none of the concurrency,
idempotency, or coupon guarantees are implemented yet.

Planned focused checks follow the agreed tasks: money/quantity edge cases; cart
validation; failed checkout leaving all state unchanged; two carts competing for
the last item; simultaneous retries with one key; order snapshots after catalog
changes; duplicate milestone generation; two checkouts competing for a coupon;
failed checkout preserving a coupon; and read-only report reconciliation. Run
`npm test`, `npm run typecheck`, and relevant build/HTTP checks as tasks land.

**Intentionally deferred:** Persistence/restart recovery, multi-instance
coordination, authentication/authorization, real payments, reservations, coupon
ownership/expiry/stacking, taxes/shipping, refunds/cancellations, pagination,
idempotency retention policies, deployment infrastructure, and load testing.
Simple CI/logging may be considered during Task 9 if time allows. A frontend is
optional and only considered after backend requirements are sound.

**Submission still pending:** Complete/test required backend behavior; make these
documents match actual code; verify setup/run/seed/check instructions from a
clean checkout; retain meaningful commits; and share a public or access-granted
repository containing source, tests, API documentation, run instructions, and this
decisions document. No hosted repository or completed submission is claimed here.

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

Codex read the assignment, generated the Task 1 tooling/app/test scaffold, ran
checks, and drafted this Task 2 design/API documentation. Checks included a real
HTTP health request; sandbox restrictions required permitted reruns of dependency
installation and local HTTP tests. Passing a health test is not evidence that
commerce invariants work.

A concrete human correction: Codex initially added explicit validation of the
`PORT` environment variable in `src/server.ts`. I rejected that defensive check
as unnecessary for this app and removed it. I also added the comment explaining
port 0 in the health test. Task 2 preserves both edits. This correction
illustrates keeping scope proportionate rather than accepting every generated
guard. It does not mean business input validation or coupon configuration
validation should be omitted.

I review and commit each task and remain responsible for every submitted line
and for explaining or modifying it. This section records actual work; it does not
claim independent authorship or invent additional rejected AI output. No private
AI transcripts are included. Update this account as later work occurs.

## First priorities with another two hours

After finishing the required backend, first examine the transaction/idempotency
boundary with failure-injection and coordinated competing HTTP requests: missing
responses, repeated keys with different identities, coupon contention, and state
unchanged after each failure. Next verify arithmetic/report reconciliation at
rounding and safe-integer boundaries. Use the remaining time to assess a durable
database transaction design and document crash/restart behavior. Prioritize these
over a larger frontend or deployment setup; update priorities based on audit gaps.
