import { Router } from 'express';
import { ragController } from '../controllers/ragController';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.post('/query', ragController.queryStream);
router.get('/history/session/:sessionId', ragController.getSessionHistory);
router.get('/sessions/workspace/:workspaceId', ragController.getWorkspaceSessions);
router.delete('/sessions/:sessionId', ragController.deleteSession);

export default router;
