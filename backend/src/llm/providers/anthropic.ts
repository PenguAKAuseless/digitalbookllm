import { LLMMessage, LLMProvider } from './types';

/** Anthropic Messages API — different request/response shape from the OpenAI family. */
export class AnthropicProvider implements LLMProvider {
    name = 'Anthropic';
    tier: 'operator' = 'operator';
    private apiKey = process.env.ANTHROPIC_API_KEY;
    private model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    private url = 'https://api.anthropic.com/v1/messages';

    isConfigured(): boolean {
        return Boolean(this.apiKey?.trim());
    }

    private headers() {
        return {
            'x-api-key': this.apiKey!,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        };
    }

    private split(messages: LLMMessage[]) {
        const system = messages.find((m) => m.role === 'system')?.content || '';
        const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
        return { system, rest };
    }

    async checkHealth(): Promise<boolean> {
        if (!this.isConfigured()) return false;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(this.url, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify({ model: this.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    async generate(messages: LLMMessage[]): Promise<string> {
        const { system, rest } = this.split(messages);
        const res = await fetch(this.url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ model: this.model, max_tokens: 800, system, messages: rest }),
        });
        if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
        const data: any = await res.json();
        return data.content?.[0]?.text ?? '';
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string> {
        const { system, rest } = this.split(messages);
        const res = await fetch(this.url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ model: this.model, max_tokens: 800, system, messages: rest, stream: true }),
        });
        if (!res.ok || !res.body) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);

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
                    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                        yield parsed.delta.text;
                    }
                } catch {
                    // Ignore malformed keep-alive chunks.
                }
            }
        }
    }
}
