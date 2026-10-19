import { Router } from 'express';
import type { CatalogService } from '../services/catalog.js';

export function productRoutes(catalog: CatalogService): Router {
  const router = Router();
  router.get('/', (_request, response) => {
    response.json(catalog.listProducts());
  });
  return router;
}
