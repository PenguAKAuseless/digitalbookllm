import { Router } from 'express';
import { ragController } from '../controllers/ragController';

const router = Router();

router.post('/query', ragController.query);
router.get('/history/:documentId', ragController.getChatHistory);
router.get('/query-count', ragController.getQueryCount);

export default router;
