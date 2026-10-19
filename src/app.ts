import express from 'express';
import { readRewardConfig } from './config.js';
import { DomainError } from './domain/errors.js';
import { errorHandler } from './http/errors.js';
import { cartRoutes } from './routes/carts.js';
import { productRoutes } from './routes/products.js';
import { orderRoutes } from './routes/orders.js';
import { couponRoutes } from './routes/coupons.js';
import { reportRoutes } from './routes/reports.js';
import { CartService } from './services/carts.js';
import { CatalogService } from './services/catalog.js';
import { OrderService } from './services/orders.js';
import { CouponService } from './services/coupons.js';
import { ReportService } from './services/reports.js';
import { InMemoryStore } from './store/memory.js';

export function createApp(store = new InMemoryStore(undefined, readRewardConfig())): express.Express {
  const app = express();

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  const orders = new OrderService(store);
  app.use('/products', productRoutes(new CatalogService(store)));
  app.use('/carts', cartRoutes(new CartService(store), orders));
  app.use('/orders', orderRoutes(orders));
  app.use('/admin/coupons', couponRoutes(new CouponService(store)));
  app.use('/admin/report', reportRoutes(new ReportService(store)));
  app.use((_request, _response, next) => {
    next(new DomainError('ROUTE_NOT_FOUND', 'Route was not found'));
  });
  app.use(errorHandler);

  return app;
}

export const app = createApp();
