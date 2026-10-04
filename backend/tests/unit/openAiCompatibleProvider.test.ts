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

    it('switches to a model the key can use when the configured one is rejected with 404', async () => {
        const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/models')) {
                return { ok: true, json: async () => ({ data: [{ id: 'whisper-large-v3' }, { id: 'fallback-model' }] }) } as unknown as Response;
            }
            const model = JSON.parse(String(init?.body)).model;
            if (model === 'test-model') {
                return { ok: false, status: 404, text: async () => 'model does not exist' } as unknown as Response;
            }
            return { ok: true, json: async () => ({ choices: [{ message: { content: `from ${model}` } }] }) } as unknown as Response;
        });
        global.fetch = fetchMock as unknown as typeof fetch;
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        const provider = new OpenAiCompatibleProvider({ ...cfg, fallbackModels: ['missing-model', 'fallback-model'] });
        await expect(provider.generate([{ role: 'user', content: 'hi' }])).resolves.toBe('from fallback-model');
        expect(fetchMock).toHaveBeenCalledWith('https://example.test/v1/models', expect.anything());
    });

    it('reports how long to wait on a 429 and skips the model until then', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: false,
            status: 429,
            headers: new Headers(),
            text: async () => 'Rate limit reached. Please try again in 7.5s.',
        } as unknown as Response);
        global.fetch = fetchMock;

        const provider = new OpenAiCompatibleProvider(cfg);
        const err = await provider.generate([{ role: 'user', content: 'hi' }]).catch((e) => e);
        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBeGreaterThan(7000);
        expect(err.retryAfterMs).toBeLessThanOrEqual(7500);

        // Still cooling down: fails fast without spending another request.
        await expect(provider.generate([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 429 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('moves on to the next model when one is rate limited', async () => {
        const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
            const model = JSON.parse(String(init?.body)).model;
            if (model === 'test-model') {
                return { ok: false, status: 429, headers: new Headers(), text: async () => 'try again in 30s' } as unknown as Response;
            }
            return { ok: true, json: async () => ({ choices: [{ message: { content: `from ${model}` } }] }) } as unknown as Response;
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const provider = new OpenAiCompatibleProvider({ ...cfg, fallbackModels: ['second-model'] });
        await expect(provider.generate([{ role: 'user', content: 'hi' }])).resolves.toBe('from second-model');
        await expect(provider.generate([{ role: 'user', content: 'hi' }])).resolves.toBe('from second-model');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('drops vendor-specific params for a model that rejects them', async () => {
        const bodies: any[] = [];
        global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            if (body.reasoning_format) return { ok: false, status: 400, text: async () => 'unsupported' } as unknown as Response;
            return { ok: true, json: async () => ({ choices: [{ message: { content: '<think>hmm</think>answer' } }] }) } as unknown as Response;
        }) as unknown as typeof fetch;

        const provider = new OpenAiCompatibleProvider({ ...cfg, modelParams: () => ({ reasoning_format: 'hidden' }) });
        await expect(provider.generate([{ role: 'user', content: 'hi' }])).resolves.toBe('answer');
        expect(bodies.map((b) => 'reasoning_format' in b)).toEqual([true, false]);
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

    function sseResponse(lines: string[]): Response {
        const bytes = new TextEncoder().encode(lines.map((l) => `data: ${l}\n\n`).join(''));
        let sent = false;
        return {
            ok: true,
            status: 200,
            body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })), cancel: async () => {} }) },
        } as unknown as Response;
    }

    it('moves a stream refused by a content filter to the next model before any output', async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(sseResponse([JSON.stringify({ error: { message: 'Input data may contain inappropriate content.' } })]))
            .mockResolvedValueOnce(sseResponse([JSON.stringify({ choices: [{ delta: { content: 'Mumbai [1].' } }] }), '[DONE]']));
        global.fetch = fetchMock;
        const provider = new OpenAiCompatibleProvider({ ...cfg, model: 'filtered-model', jsonModel: 'other-model' });

        let text = '';
        for await (const delta of provider.generateStream([{ role: 'user', content: 'q' }])) text += delta;

        expect(text).toBe('Mumbai [1].');
        expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).model)).toEqual(['filtered-model', 'other-model']);
    });

    it('reports a content-filter refusal from every model as a non-retryable 451', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            headers: new Headers(),
            text: async () => '{"error":{"message":"Input data may contain inappropriate content."}}',
        } as unknown as Response);
        const provider = new OpenAiCompatibleProvider({ ...cfg, model: 'a', jsonModel: 'b' });

        await expect(provider.generate([{ role: 'user', content: 'q' }])).rejects.toMatchObject({ status: 451 });
        expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
    });

    it('treats a refusal written as the reply (deepseek-v3 "sensitive information") as a content-filter error', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: '当前输入涉及敏感信息，让我们换个话题。' } }] }),
        } as unknown as Response);
        const provider = new OpenAiCompatibleProvider({ ...cfg, model: 'a', jsonModel: 'b' });

        await expect(provider.generate([{ role: 'user', content: 'extract' }], { json: true })).rejects.toMatchObject({ status: 451 });
    });

    it('sends JSON requests to the jsonModel and everything else to the main model', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: '{}' } }] }),
        } as unknown as Response);
        global.fetch = fetchMock;
        const provider = new OpenAiCompatibleProvider({ ...cfg, model: 'reasoning-model', jsonModel: 'instruct-model' });

        await provider.generate([{ role: 'user', content: 'extract' }], { json: true });
        await provider.generate([{ role: 'user', content: 'chat' }]);

        const models = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).model);
        expect(models).toEqual(['instruct-model', 'reasoning-model']);
    });
});
