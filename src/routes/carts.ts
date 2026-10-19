import { Router } from 'express';
import { jsonBody } from '../http/json.js';
import type { CartService } from '../services/carts.js';
import type { OrderService } from '../services/orders.js';

export function cartRoutes(carts: CartService, orders: OrderService): Router {
  const router = Router();

  router.post('/', jsonBody, (request, response) => {
    const cart = carts.createCart(request.body);
    response.location(`/carts/${cart.id}`).status(201).json(cart);
  });

  router.get('/:cartId', (request, response) => {
    response.json(carts.getCart(request.params.cartId));
  });

  router.post<{ cartId: string }>('/:cartId/items', jsonBody, (request, response) => {
    response.json(carts.addItem(request.params.cartId, request.body));
  });

  router.patch<{ cartId: string; productId: string }>(
    '/:cartId/items/:productId', jsonBody, (request, response) => {
      response.json(carts.updateItem(request.params.cartId, request.params.productId, request.body));
    },
  );

  router.delete('/:cartId/items/:productId', (request, response) => {
    response.json(carts.removeItem(request.params.cartId, request.params.productId));
  });

  router.post<{ cartId: string }>('/:cartId/checkout', jsonBody, (request, response) => {
    const order = orders.checkout(request.params.cartId, request.body);
    response.location(`/orders/${order.id}`).status(201).json(order);
  });

  return router;
}
