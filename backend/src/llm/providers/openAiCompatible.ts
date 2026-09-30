import { GenerateOptions, LLMMessage, LLMProvider } from './types';

export interface OpenAiCompatibleConfig {
    name: string;
    tier: 'operator' | 'gemini' | 'groq';
    baseUrl: string;
    apiKey: string | undefined;
    model: string;
    /** Header carrying the key. OpenAI-family APIs use Authorization: Bearer, Azure uses api-key. */
    authHeader?: 'authorization' | 'api-key';
    timeoutMs?: number;
}

/**
 * Chat-completions provider for any OpenAI-schema-compatible endpoint:
 * OpenAI, Groq, Cerebras, SambaNova, Mistral, OpenRouter, Azure OpenAI.
 * Handles both blocking and SSE-streamed responses against `POST {baseUrl}`.
 */
export class OpenAiCompatibleProvider implements LLMProvider {
    name: string;
    tier: 'operator' | 'gemini' | 'groq';

    constructor(private cfg: OpenAiCompatibleConfig) {
        this.name = cfg.name;
        this.tier = cfg.tier;
    }

    isConfigured(): boolean {
        return Boolean(this.cfg.apiKey && this.cfg.apiKey.trim().length > 0);
    }

    private headers(): Record<string, string> {
        const header = this.cfg.authHeader || 'authorization';
        return {
            'Content-Type': 'application/json',
            ...(header === 'api-key'
                ? { 'api-key': this.cfg.apiKey! }
                : { Authorization: `Bearer ${this.cfg.apiKey}` }),
        };
    }

    async checkHealth(): Promise<boolean> {
        if (!this.isConfigured()) return false;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(this.cfg.baseUrl, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify({
                    model: this.cfg.model,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1,
                }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    async generate(messages: LLMMessage[], options: GenerateOptions = {}): Promise<string> {
        // `response_format` is not honoured uniformly across these vendors, so JSON is enforced by prompt only.
        const res = await fetch(this.cfg.baseUrl, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
                model: this.cfg.model,
                messages,
                temperature: options.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? 800,
            }),
        });
        if (!res.ok) throw new Error(`${this.name} HTTP ${res.status}: ${await res.text()}`);
        const data: any = await res.json();
        return data.choices?.[0]?.message?.content ?? '';
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string> {
        const res = await fetch(this.cfg.baseUrl, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
                model: this.cfg.model,
                messages,
                temperature: 0.7,
                max_tokens: 800,
                stream: true,
            }),
        });
        if (!res.ok || !res.body) throw new Error(`${this.name} HTTP ${res.status}: ${await res.text()}`);

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
                const payload = trimmed.slice(5).trim();
                if (payload === '[DONE]') return;
                try {
                    const parsed = JSON.parse(payload);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) yield delta;
                } catch {
                    // Ignore malformed keep-alive chunks.
                }
            }
        }
    }
}
