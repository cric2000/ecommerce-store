import { Router } from 'express';
import { jsonBody } from '../http/json.js';
import type { CouponService } from '../services/coupons.js';

export function couponRoutes(coupons: CouponService): Router {
  const router = Router();
  router.post('/', jsonBody, async (request, response) => {
    response.status(201).json(await coupons.generate(request.body));
  });
  return router;
}
