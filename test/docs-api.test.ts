import SwaggerParser from '@apidevtools/swagger-parser';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OpenAPIV3 } from 'openapi-types';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store/memory.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(createApp(new InMemoryStore(undefined, { couponInterval: 1, discountPercent: 10 })));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('served OpenAPI is valid and includes every operation in the written API contract', async () => {
  const response = await fetch(`${baseUrl}/docs/openapi.json`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  const spec: OpenAPIV3.Document = await response.json();
  expect(spec.servers).toEqual([{ url: '/', description: expect.any(String) }]);
  const methods = ['get', 'post', 'patch', 'delete'] as const;
  const documented = Object.entries(spec.paths).flatMap(([path, item]) => (
    methods.filter((method) => item?.[method]).map((method) => `${method.toUpperCase()} ${path}`)
  ));
  const contract = await readFile(new URL('../API.md', import.meta.url), 'utf8');
  const index = contract.split('## Endpoint index')[1].split('## Response shapes')[0];
  const expected = [...index.matchAll(/`(GET|POST|PATCH|DELETE) ([^`]+)`/g)]
    .map(([, method, path]) => `${method} ${path.replace(/:([A-Za-z]+)/g, '{$1}')}`);
  expect(expected).toHaveLength(11);
  expect(documented.sort()).toEqual(expected.sort());
  // This checks the OpenAPI structure and resolves every schema reference.
  await SwaggerParser.validate(spec);
});

test('Swagger UI loads local assets at both /docs and /docs/ without serving package files', async () => {
  for (const path of ['/docs', '/docs/']) {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain("url: '/docs/openapi.json'");
    expect(html).toContain('href="/docs/swagger-ui.css"');
    expect(html).toContain('src="/docs/swagger-ui-bundle.js"');
    expect(html).toContain('validatorUrl: null');
  }
  for (const [path, type] of [['swagger-ui.css', 'text/css'], ['swagger-ui-bundle.js', 'javascript']]) {
    const response = await fetch(`${baseUrl}/docs/${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(type);
    expect((await response.text()).length).toBeGreaterThan(100);
  }
  const hidden = await fetch(`${baseUrl}/docs/package.json`);
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
});

test('documented request examples work, including checkout key validation and successful replay', async () => {
  const spec: OpenAPIV3.Document = await (await fetch(`${baseUrl}/docs/openapi.json`)).json();
  function example(path: string, name: string): unknown {
    const requestBody = spec.paths[path]!.post!.requestBody as OpenAPIV3.RequestBodyObject;
    return (requestBody.content['application/json'].examples![name] as OpenAPIV3.ExampleObject).value;
  }
  const post = (path: string, value: unknown, headers = {}) => fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
  });
  const created = await post('/carts', example('/carts', 'empty'));
  expect(created.status).toBe(201);
  const cart = await created.json();
  expect(created.headers.get('location')).toBe(`/carts/${cart.id}`);
  const added = await post(`/carts/${cart.id}/items`, example('/carts/{cartId}/items', 'notebook'));
  expect(added.status).toBe(200);
  expect((await added.json()).subtotalPaise).toBe(12500);

  const checkoutBody = example('/carts/{cartId}/checkout', 'withoutCoupon');
  const checkoutPath = `/carts/${cart.id}/checkout`;
  const missingKey = await post(checkoutPath, checkoutBody);
  expect(missingKey.status).toBe(400);
  expect(await missingKey.json()).toMatchObject({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } });
  const key = spec.paths['/carts/{cartId}/checkout']!.post!.parameters!
    .find((item) => 'name' in item && item.name === 'Idempotency-Key') as OpenAPIV3.ParameterObject;
  expect(key.required).toBe(true);
  const headers = { 'Idempotency-Key': key.example };
  const placed = await post(checkoutPath, checkoutBody, headers);
  expect(placed.status).toBe(201);
  const order = await placed.json();
  expect(order).toMatchObject({ cartId: cart.id, coupon: null, subtotalPaise: 12500, totalPaise: 12500 });
  const replay = await post(checkoutPath, checkoutBody, headers);
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(order);
  expect(replay.headers.get('location')).toBe(placed.headers.get('location'));

  const generated = await post('/admin/coupons', example('/admin/coupons', 'empty'));
  expect(generated.status).toBe(201);
  expect(await generated.json()).toMatchObject({ milestone: 1, status: 'available' });
  const report = await (await fetch(`${baseUrl}/admin/report`)).json();
  expect(report).toMatchObject({ totalOrders: 1, grossRevenuePaise: 12500, coupons: { generated: 1, available: 1, redeemed: 0 } });
});
