import { Router } from 'express';
import { OrderService } from '../services/orders.js';
import type { StoreAccess } from '../store/access.js';

export function orderRoutes(access: StoreAccess): Router {
  const router = Router();
  router.get('/:orderId', async (request, response) => {
    response.json(await access.read((store) => new OrderService(store).getOrder(request.params.orderId)));
  });
  return router;
}
