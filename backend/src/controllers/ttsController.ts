import { Response, NextFunction } from 'express';
import { streamTextToSpeech } from '../tts/stream';
import { AuthRequest } from '../middleware/auth';

const MAX_TTS_CHARS = 2000;

/** Streamed text-to-speech (FR09, UC12). */
export class TTSController {
    async stream(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { text, lang = 'vi' } = req.body;
            if (!text?.trim()) return res.status(400).json({ success: false, error: 'text is required' });

            const trimmed = text.slice(0, MAX_TTS_CHARS);
            await streamTextToSpeech(trimmed, lang, res);
        } catch (error: any) {
            // A missing provider is an expected, client-handled case (falls back to
            // browser speech synthesis) — surface it as a normal error response, not a 500.
            res.status(503).json({ success: false, error: error?.message || 'TTS unavailable', fallback: 'client' });
        }
    }
}

export const ttsController = new TTSController();
