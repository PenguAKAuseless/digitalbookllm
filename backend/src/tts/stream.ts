import { Response } from 'express';

/**
 * Streams synthesized speech for the given text (FR09), proxying a network
 * TTS provider so audio playback can start before synthesis finishes. If no
 * provider is configured the caller should fall back to the browser
 * `SpeechSynthesis` API (ADR-08) — this function throws in that case so the
 * controller can respond with a clear "no provider" signal instead of a
 * silent empty stream.
 */
export async function streamTextToSpeech(text: string, lang: string, res: Response): Promise<void> {
    const provider = process.env.TTS_PROVIDER_URL;
    if (!provider) {
        throw new Error('No streaming TTS provider configured (set TTS_PROVIDER_URL). Use client-side speech synthesis instead.');
    }

    const upstream = await fetch(provider, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
    });

    if (!upstream.ok || !upstream.body) {
        throw new Error(`TTS provider HTTP ${upstream.status}`);
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const reader = upstream.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
    }
    res.end();
}
