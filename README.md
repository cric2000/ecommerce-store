# Checkout and rewards service

Backend take-home assignment using Node.js, TypeScript, Express, and Vitest.
The complete requirements are preserved in [ASSIGNMENT.md](ASSIGNMENT.md).

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

Task 1 provides only project tooling, app/server entry points, and the health
endpoint. Products, seed data, carts, checkout, coupons, reporting, API contracts,
and `DECISIONS.md` are pending later tasks. No frontend is included.
