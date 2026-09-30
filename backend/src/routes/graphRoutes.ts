import { Router } from 'express';
import { graphController } from '../controllers/graphController';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', graphController.getGraph);
router.get('/documents/:documentId/extraction', graphController.getExtractionStatus);
router.post('/documents/:documentId/extraction', graphController.requestExtraction);
router.get('/:entityId', graphController.getEntity);

export default router;
