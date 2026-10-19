import { Router } from 'express';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { openapi } from '../http/openapi.js';

const swaggerAssets = dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));

export function docsRoutes(): Router {
  const router = Router();
  router.get('/openapi.json', (_request, response) => response.json(openapi));
  for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js']) {
    router.get(`/${asset}`, (_request, response) => response.sendFile(join(swaggerAssets, asset)));
  }
  router.get('/', (_request, response) => {
    response.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Checkout and rewards API — Swagger UI</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      validatorUrl: null
    });
  </script>
</body>
</html>`);
  });
  return router;
}
