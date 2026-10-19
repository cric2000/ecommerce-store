import express from 'express';
import { DomainError } from './domain/errors.js';
import { errorHandler } from './http/errors.js';
import { cartRoutes } from './routes/carts.js';
import { productRoutes } from './routes/products.js';
import { CartService } from './services/carts.js';
import { CatalogService } from './services/catalog.js';
import { InMemoryStore } from './store/memory.js';

export function createApp(store = new InMemoryStore()): express.Express {
  const app = express();

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use('/products', productRoutes(new CatalogService(store)));
  app.use('/carts', cartRoutes(new CartService(store)));
  app.use((_request, _response, next) => {
    next(new DomainError('ROUTE_NOT_FOUND', 'Route was not found'));
  });
  app.use(errorHandler);

  return app;
}

export const app = createApp();
