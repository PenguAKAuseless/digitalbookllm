import { OpenAiCompatibleProvider } from '../../src/llm/providers/openAiCompatible';

describe('OpenAiCompatibleProvider', () => {
    const cfg = {
        name: 'TestProvider',
        tier: 'operator' as const,
        baseUrl: 'https://example.test/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('is not configured without an API key', () => {
        const provider = new OpenAiCompatibleProvider({ ...cfg, apiKey: undefined });
        expect(provider.isConfigured()).toBe(false);
    });

    it('reports healthy when the endpoint responds 200 to a 1-token probe', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response);
        const provider = new OpenAiCompatibleProvider(cfg);
        await expect(provider.checkHealth()).resolves.toBe(true);
    });

    it('reports unhealthy when the endpoint errors or is unreachable', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
        const provider = new OpenAiCompatibleProvider(cfg);
        await expect(provider.checkHealth()).resolves.toBe(false);
    });

    it('extracts the message content from a blocking chat-completion response', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'hello world' } }] }),
        } as unknown as Response);

        const provider = new OpenAiCompatibleProvider(cfg);
        const result = await provider.generate([{ role: 'user', content: 'hi' }]);
        expect(result).toBe('hello world');
    });

    it('throws with the response body on a non-2xx status', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 429,
            text: async () => 'rate limited',
        } as unknown as Response);

        const provider = new OpenAiCompatibleProvider(cfg);
        await expect(provider.generate([{ role: 'user', content: 'hi' }])).rejects.toThrow(/429/);
    });

    it('parses SSE delta chunks from a streamed response', async () => {
        const sse =
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
            'data: [DONE]\n\n';
        const encoder = new TextEncoder();
        const bytes = encoder.encode(sse);

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader: () => {
                    let sent = false;
                    return {
                        read: async () => {
                            if (sent) return { done: true, value: undefined };
                            sent = true;
                            return { done: false, value: bytes };
                        },
                    };
                },
            },
        } as unknown as Response);

        const provider = new OpenAiCompatibleProvider(cfg);
        const deltas: string[] = [];
        for await (const delta of provider.generateStream([{ role: 'user', content: 'hi' }])) {
            deltas.push(delta);
        }
        expect(deltas.join('')).toBe('Hello');
    });
});
