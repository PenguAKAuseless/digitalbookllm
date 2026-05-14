import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { AuthRequest } from '../middleware/auth';

export class AuthController {
    async register(req: Request, res: Response, next: NextFunction) {
        try {
            const { email, password } = req.body;

            if (!email?.trim() || !password?.trim()) {
                return res.status(400).json({ success: false, error: 'Email and password are required' });
            }
            if (password.length < 6) {
                return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ success: false, error: 'Invalid email address' });
            }

            const { user, token } = await authService.register(email.trim(), password);
            res.status(201).json({ success: true, data: { user, token } });
        } catch (error) {
            next(error);
        }
    }

    async login(req: Request, res: Response, next: NextFunction) {
        try {
            const { email, password } = req.body;

            if (!email?.trim() || !password?.trim()) {
                return res.status(400).json({ success: false, error: 'Email and password are required' });
            }

            const { user, token } = await authService.login(email.trim(), password);
            res.json({ success: true, data: { user, token } });
        } catch (error) {
            next(error);
        }
    }

    async me(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const user = await authService.getUser(req.userId!);
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            res.json({ success: true, data: { user } });
        } catch (error) {
            next(error);
        }
    }
}

export const authController = new AuthController();
