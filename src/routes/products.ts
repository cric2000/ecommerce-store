import { Router } from 'express';
import { CatalogService } from '../services/catalog.js';
import type { StoreAccess } from '../store/access.js';

export function productRoutes(access: StoreAccess): Router {
  const router = Router();
  router.get('/', async (_request, response) => {
    response.json(await access.read((store) => new CatalogService(store).listProducts()));
  });
  return router;
}
