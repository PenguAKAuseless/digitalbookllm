import { Response, NextFunction } from 'express';
import { workspaceService } from '../services/workspaceService';
import { AuthRequest } from '../middleware/auth';

export class WorkspaceController {
    async getWorkspaces(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspaces = await workspaceService.getWorkspaces(req.userId!);
            res.json({ success: true, data: workspaces });
        } catch (error) {
            next(error);
        }
    }

    async getWorkspace(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const workspace = await workspaceService.getWorkspace(req.params.id, req.userId!);
            if (!workspace) {
                return res.status(404).json({ success: false, error: 'Workspace not found' });
            }
            res.json({ success: true, data: workspace });
        } catch (error) {
            next(error);
        }
    }

    async createWorkspace(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { name, description } = req.body;
            if (!name?.trim()) {
                return res.status(400).json({ success: false, error: 'Workspace name is required' });
            }
            const workspace = await workspaceService.createWorkspace(req.userId!, name, description);
            res.status(201).json({ success: true, data: workspace });
        } catch (error: any) {
            if (error?.code === '23505') {
                return res.status(409).json({ success: false, error: 'A workspace with that name already exists' });
            }
            next(error);
        }
    }

    async updateWorkspace(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { name, description } = req.body;
            if (!name?.trim()) {
                return res.status(400).json({ success: false, error: 'Workspace name is required' });
            }
            const workspace = await workspaceService.updateWorkspace(req.params.id, req.userId!, name, description);
            if (!workspace) {
                return res.status(404).json({ success: false, error: 'Workspace not found' });
            }
            res.json({ success: true, data: workspace });
        } catch (error: any) {
            if (error?.code === '23505') {
                return res.status(409).json({ success: false, error: 'A workspace with that name already exists' });
            }
            next(error);
        }
    }

    async deleteWorkspace(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const deleted = await workspaceService.deleteWorkspace(req.params.id, req.userId!);
            if (!deleted) {
                return res.status(404).json({ success: false, error: 'Workspace not found' });
            }
            res.json({ success: true, message: 'Workspace deleted' });
        } catch (error) {
            next(error);
        }
    }
}

export const workspaceController = new WorkspaceController();
