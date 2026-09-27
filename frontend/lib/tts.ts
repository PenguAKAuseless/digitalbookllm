import { API_BASE, authToken } from './api/http';

/**
 * Text-to-speech (UC12, FR09): tries the server's streaming endpoint first,
 * falling back to the browser's built-in SpeechSynthesis API when no
 * provider is configured server-side (ADR-08) — so "Speak" always works.
 */
export async function speak(text: string, lang: 'vi' | 'en'): Promise<() => void> {
    try {
        const res = await fetch(`${API_BASE}/tts/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
            },
            body: JSON.stringify({ text, lang }),
        });

        if (res.ok && res.body) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play();
            return () => {
                audio.pause();
                URL.revokeObjectURL(url);
            };
        }
    } catch {
        // fall through to client-side synthesis
    }

    return speakInBrowser(text, lang);
}

function speakInBrowser(text: string, lang: 'vi' | 'en'): () => void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return () => undefined;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    return () => window.speechSynthesis.cancel();
}
