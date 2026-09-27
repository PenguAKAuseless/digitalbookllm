import { Router } from 'express';
import { graphController } from '../controllers/graphController';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', graphController.getGraph);
router.get('/:entityId', graphController.getEntity);

export default router;
