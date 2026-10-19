import { Router } from 'express';
import { jsonBody } from '../http/json.js';
import { CouponService } from '../services/coupons.js';
import type { StoreAccess } from '../store/access.js';

export function couponRoutes(access: StoreAccess): Router {
  const router = Router();
  router.post('/', jsonBody, async (request, response) => {
    response.status(201).json(await access.write((store) => new CouponService(store).generate(request.body)));
  });
  return router;
}
