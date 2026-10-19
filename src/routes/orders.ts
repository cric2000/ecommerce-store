import { Router } from 'express';
import type { OrderService } from '../services/orders.js';

export function orderRoutes(orders: OrderService): Router {
  const router = Router();
  router.get('/:orderId', (request, response) => {
    response.json(orders.getOrder(request.params.orderId));
  });
  return router;
}
