import express from 'express';
import { fileURLToPath } from 'node:url';
import { readRewardConfig } from './config.js';
import { DomainError } from './domain/errors.js';
import { errorHandler } from './http/errors.js';
import { cartRoutes } from './routes/carts.js';
import { productRoutes } from './routes/products.js';
import { orderRoutes } from './routes/orders.js';
import { couponRoutes } from './routes/coupons.js';
import { reportRoutes } from './routes/reports.js';
import { docsRoutes } from './routes/docs.js';
import { InMemoryStore } from './store/memory.js';
import { MemoryStoreAccess, type StoreAccess } from './store/access.js';
import { PostgresStoreAccess } from './store/postgres.js';

function configuredStore(): StoreAccess {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (process.env.VERCEL && !databaseUrl) {
    throw new Error('DATABASE_URL is required on Vercel so instances share checkout state');
  }
  const seed = new InMemoryStore(undefined, readRewardConfig());
  return databaseUrl
    ? new PostgresStoreAccess(databaseUrl, seed, process.env.STORE_NAMESPACE)
    : new MemoryStoreAccess(seed);
}

export function createApp(store?: InMemoryStore | StoreAccess): express.Express {
  const source = store ?? new InMemoryStore(undefined, readRewardConfig());
  const access = source instanceof InMemoryStore ? new MemoryStoreAccess(source) : source;
  const app = express();
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use('/docs', docsRoutes());

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use('/products', productRoutes(access));
  app.use('/carts', cartRoutes(access));
  app.use('/orders', orderRoutes(access));
  app.use('/admin/coupons', couponRoutes(access));
  app.use('/admin/report', reportRoutes(access));
  app.use((_request, _response, next) => {
    next(new DomainError('ROUTE_NOT_FOUND', 'Route was not found'));
  });
  app.use(errorHandler);

  return app;
}

export const app = createApp(configuredStore());
export default app;
