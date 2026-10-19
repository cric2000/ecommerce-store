# Checkout and rewards service

Backend take-home assignment using Node.js, TypeScript, Express, and Vitest.
The complete requirements are preserved in [ASSIGNMENT.md](ASSIGNMENT.md).
The planned HTTP contract is in [API.md](API.md), and the design choices,
invariants, scope, and actual AI use are in [DECISIONS.md](DECISIONS.md).
Only the health endpoint is implemented; the other API behavior is planned.

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

## Checks

```sh
npm test
npm run typecheck
npm run build
```

`npm run test:watch` runs Vitest in watch mode. The health test starts an HTTP
server on an available loopback port and closes it after the test.

## Current scope

Tasks 1–3 provide project tooling, app/server entry points, the health endpoint,
the planned API contract/design documentation, domain types, shared validation
and errors, and exact integer-paise money helpers with focused tests.

Domain code lives in `src/domain/`: `types.ts` defines stored records and response
shapes, `validation.ts` rejects invalid quantities/percentages/paise, `errors.ts`
provides structured domain failures, and `money.ts` performs exact arithmetic
with `bigint` intermediates and safe numeric outputs. Rupee conversion takes a
decimal string rather than a floating-point number; formatted rupees are strings.

Product seed data, store/services, cart lifecycle, checkout, coupons, reporting,
their routes, and flow/concurrency tests are pending later tasks. No frontend is
included. The health route remains the only implemented HTTP endpoint.
