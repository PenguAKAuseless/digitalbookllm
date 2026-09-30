import { GenerateOptions, LLMMessage, LLMProvider } from './types';

/** Google Gemini free tier — tier 2 in the router (ADR-07): broad quota, good Vietnamese support. */
export class GeminiProvider implements LLMProvider {
    name = 'Gemini';
    tier: 'gemini' = 'gemini';
    private apiKey = process.env.GEMINI_API_KEY;
    private model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    isConfigured(): boolean {
        return Boolean(this.apiKey?.trim());
    }

    private endpoint(stream: boolean): string {
        const action = stream ? 'streamGenerateContent' : 'generateContent';
        const sse = stream ? '&alt=sse' : '';
        return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${action}?key=${this.apiKey}${sse}`;
    }

    private toGeminiPayload(messages: LLMMessage[], options: GenerateOptions = {}) {
        const system = messages.find((m) => m.role === 'system')?.content;
        const contents = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        return {
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: {
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens ?? 800,
                ...(options.json ? { responseMimeType: 'application/json' } : {}),
            },
        };
    }

    async checkHealth(): Promise<boolean> {
        if (!this.isConfigured()) return false;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(this.endpoint(false), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.toGeminiPayload([{ role: 'user', content: 'ping' }])),
                signal: controller.signal,
            });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    async generate(messages: LLMMessage[], options?: GenerateOptions): Promise<string> {
        const res = await fetch(this.endpoint(false), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.toGeminiPayload(messages, options)),
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
        const data: any = await res.json();
        return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string> {
        const res = await fetch(this.endpoint(true), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.toGeminiPayload(messages)),
        });
        if (!res.ok || !res.body) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                try {
                    const parsed = JSON.parse(trimmed.slice(5).trim());
                    const text = parsed.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('');
                    if (text) yield text;
                } catch {
                    // Ignore malformed keep-alive chunks.
                }
            }
        }
    }
}
