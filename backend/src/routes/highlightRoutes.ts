import { Router } from 'express';
import { highlightController } from '../controllers/highlightController';
import { requireAuth } from '../middleware/auth';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', highlightController.list);
router.post('/', highlightController.create);
router.put('/:id', highlightController.update);
router.delete('/:id', highlightController.remove);

export default router;
