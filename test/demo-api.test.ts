import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from '../src/app.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(createApp());
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

test('the demo and its browser modules/styles are served alongside the unchanged JSON API', async () => {
  const page = await fetch(baseUrl);
  expect(page.status).toBe(200);
  expect(page.headers.get('content-type')).toContain('text/html');
  const html = await page.text();
  expect(html).toContain('src="/app.js"');
  expect(html).toContain('href="/styles.css"');
  for (const [path, contentType] of [['/app.js', 'javascript'], ['/client.js', 'javascript'], ['/styles.css', 'text/css']]) {
    const asset = await fetch(`${baseUrl}${path}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain(contentType);
  }
  const catalog = await fetch(`${baseUrl}/products`);
  expect(catalog.status).toBe(200);
  expect((await catalog.json()).products).toHaveLength(5);
});

test('static serving exposes only public assets, preserving structured 404s for other files', async () => {
  for (const path of ['/package.json', '/src/server.ts', '/.env', '/missing.js']) {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
  }
});
