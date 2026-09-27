import { Response } from 'express';

/**
 * Streams synthesized speech through a configured provider. If no provider is
 * configured, the controller returns a response that lets the browser use its
 * native SpeechSynthesis fallback.
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
