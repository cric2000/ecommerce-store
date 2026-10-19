import { Router } from 'express';
import { jsonBody } from '../http/json.js';
import type { CartService } from '../services/carts.js';
import type { OrderService } from '../services/orders.js';

export function cartRoutes(carts: CartService, orders: OrderService): Router {
  const router = Router();

  router.post('/', jsonBody, async (request, response) => {
    const cart = await carts.createCart(request.body);
    response.location(`/carts/${cart.id}`).status(201).json(cart);
  });

  router.get('/:cartId', (request, response) => {
    response.json(carts.getCart(request.params.cartId));
  });

  router.post<{ cartId: string }>('/:cartId/items', jsonBody, async (request, response) => {
    response.json(await carts.addItem(request.params.cartId, request.body));
  });

  router.patch<{ cartId: string; productId: string }>(
    '/:cartId/items/:productId', jsonBody, async (request, response) => {
      response.json(await carts.updateItem(request.params.cartId, request.params.productId, request.body));
    },
  );

  router.delete('/:cartId/items/:productId', async (request, response) => {
    response.json(await carts.removeItem(request.params.cartId, request.params.productId));
  });

  router.post<{ cartId: string }>('/:cartId/checkout', jsonBody, async (request, response) => {
    const keys = request.headersDistinct['idempotency-key'];
    const key = keys?.length === 1 ? keys[0] : undefined;
    const order = await orders.checkout(request.params.cartId, request.body, key);
    response.location(`/orders/${order.id}`).status(201).json(order);
  });

  return router;
}
