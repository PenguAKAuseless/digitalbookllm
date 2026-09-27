import { Request, Response, NextFunction } from 'express';
import { llmRouter } from '../llm/router';

/** Diagnostics for the LLM provider router (ADR-07) — surfaces which providers are live. */
export class SystemController {
    async llmStatus(_req: Request, res: Response, next: NextFunction) {
        try {
            const providers = await llmRouter.statusReport();
            res.json({ success: true, data: providers });
        } catch (error) {
            next(error);
        }
    }
}

export const systemController = new SystemController();
