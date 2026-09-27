import { Router } from 'express';
import { systemController } from '../controllers/systemController';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/llm-status', systemController.llmStatus);

export default router;
