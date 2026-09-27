import { Router } from 'express';
import { ttsController } from '../controllers/ttsController';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.post('/stream', ttsController.stream);

export default router;
