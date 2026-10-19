import { Router } from 'express';
import { ReportService } from '../services/reports.js';
import type { StoreAccess } from '../store/access.js';

export function reportRoutes(access: StoreAccess): Router {
  const router = Router();
  router.get('/', async (_request, response) => {
    response.json(await access.read((store) => new ReportService(store).getReport()));
  });
  return router;
}
