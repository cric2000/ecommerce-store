import { Router } from 'express';
import { jsonBody } from '../http/json.js';
import { CartService } from '../services/carts.js';
import { OrderService } from '../services/orders.js';
import type { StoreAccess } from '../store/access.js';

export function cartRoutes(access: StoreAccess): Router {
  const router = Router();

  router.post('/', jsonBody, async (request, response) => {
    const cart = await access.write((store) => new CartService(store).createCart(request.body));
    response.location(`/carts/${cart.id}`).status(201).json(cart);
  });

  router.get('/:cartId', async (request, response) => {
    response.json(await access.read((store) => new CartService(store).getCart(request.params.cartId)));
  });

  router.post<{ cartId: string }>('/:cartId/items', jsonBody, async (request, response) => {
    const cart = await access.write((store) => new CartService(store).addItem(request.params.cartId, request.body));
    response.json(cart);
  });

  router.patch<{ cartId: string; productId: string }>(
    '/:cartId/items/:productId', jsonBody, async (request, response) => {
      const cart = await access.write((store) => new CartService(store).updateItem(
        request.params.cartId, request.params.productId, request.body,
      ));
      response.json(cart);
    },
  );

  router.delete('/:cartId/items/:productId', async (request, response) => {
    const cart = await access.write((store) => new CartService(store).removeItem(
      request.params.cartId, request.params.productId,
    ));
    response.json(cart);
  });

  router.post<{ cartId: string }>('/:cartId/checkout', jsonBody, async (request, response) => {
    const keys = request.headersDistinct['idempotency-key'];
    const key = keys?.length === 1 ? keys[0] : undefined;
    const order = await access.write((store) => new OrderService(store).checkout(request.params.cartId, request.body, key));
    response.location(`/orders/${order.id}`).status(201).json(order);
  });

  return router;
}
