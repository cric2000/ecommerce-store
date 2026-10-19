import { Router } from 'express';
import type { ReportService } from '../services/reports.js';

export function reportRoutes(reports: ReportService): Router {
  const router = Router();
  router.get('/', (_request, response) => {
    response.json(reports.getReport());
  });
  return router;
}
