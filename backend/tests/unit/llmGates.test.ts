import { llmRouter } from '../../src/llm/router';
import { isLanguageSlip, isTransientLLMError } from '../../src/llm/retry';
import { LLMMessage, LLMProvider, ProviderHttpError } from '../../src/llm/providers/types';
import { extractWindowGraph } from '../../src/queue/handlers/extractEntities';

/** A provider whose replies are scripted per call: a string is streamed/returned, an Error is thrown. */
function scripted(name: string, script: Array<string | Error>): LLMProvider & { calls: LLMMessage[][] } {
    const calls: LLMMessage[][] = [];
    const next = (messages: LLMMessage[]) => {
        calls.push(messages);
        const step = script[Math.min(calls.length - 1, script.length - 1)];
        if (step instanceof Error) throw step;
        return step;
    };
    return {
        name,
        tier: 'operator',
        calls,
        isConfigured: () => true,
        checkHealth: async () => true,
        generate: async (messages) => next(messages),
        async *generateStream(messages) {
            const text = next(messages);
            for (let i = 0; i < text.length; i += 5) yield text.slice(i, i + 5);
        },
    };
}

function useProviders(...providers: LLMProvider[]) {
    (llmRouter as any).providers = providers;
    (llmRouter as any).healthCache.clear();
}

async function streamText(query: string): Promise<{ text: string; providers: string[] }> {
    let text = '';
    const providers: string[] = [];
    for await (const ev of llmRouter.generateAnswerStream(query, undefined, [{ text: 'Paris là thủ đô của Pháp.' }])) {
        if (ev.delta) text += ev.delta;
        if (ev.provider) providers.push(ev.provider);
    }
    return { text, providers };
}

describe('isTransientLLMError', () => {
    it('retries server errors, timeouts and dropped connections, not client errors or rate limits', () => {
        expect(isTransientLLMError(new ProviderHttpError('Ollama HTTP 500: cudaMalloc failed: out of memory', 500))).toBe(true);
        expect(isTransientLLMError(new ProviderHttpError('bad gateway', 502))).toBe(true);
        expect(isTransientLLMError(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true);
        expect(isTransientLLMError(new TypeError('fetch failed'))).toBe(true);
        expect(isTransientLLMError(new ProviderHttpError('invalid api key', 401))).toBe(false);
        expect(isTransientLLMError(new ProviderHttpError('model not found', 404))).toBe(false);
        expect(isTransientLLMError(new ProviderHttpError('rate limited', 429))).toBe(false);
    });
});

describe('isLanguageSlip', () => {
    it('flags a CJK reply to a Vietnamese or English question, but not to a Chinese one', () => {
        expect(isLanguageSlip('Kinh tế mạnh về gì?', '文档未提供此信息')).toBe(true);
        expect(isLanguageSlip('Where is Paris?', 'Paris is in 法国')).toBe(true);
        expect(isLanguageSlip('Kinh tế mạnh về gì?', 'Giáo dục và nghệ thuật [1]')).toBe(false);
        expect(isLanguageSlip('巴黎在哪里？', '巴黎在法国')).toBe(false);
    });

    it('flags a reply with no Vietnamese letters to a Vietnamese question only once enough text is in', () => {
        expect(isLanguageSlip('Ai là tổng thống?', 'The document does not provide', true)).toBe(true);
        expect(isLanguageSlip('Ai là tổng thống?', 'Paris', false)).toBe(false);
        expect(isLanguageSlip('Ai là tổng thống?', 'Paris là thủ đô của nước Pháp', true)).toBe(false);
        expect(isLanguageSlip('Who is the president?', 'The document does not provide', true)).toBe(false);
    });
});

describe('LLM router gates', () => {
    const original = (llmRouter as any).providers;
    afterAll(() => useProviders(...original));

    it('re-sends to the same provider after a transient failure (single provider: nothing to fail over to)', async () => {
        const p = scripted('Solo', [new ProviderHttpError('HTTP 500 out of memory', 500), '{"ok":true}']);
        useProviders(p);
        await expect(llmRouter.generate([{ role: 'user', content: 'x' }])).resolves.toEqual({ text: '{"ok":true}', provider: 'Solo' });
        expect(p.calls).toHaveLength(2);
    });

    it('does not retry a client error and fails over to the next provider', async () => {
        const a = scripted('A', [new ProviderHttpError('HTTP 401', 401)]);
        const b = scripted('B', ['answer']);
        useProviders(a, b);
        await expect(llmRouter.generate([{ role: 'user', content: 'x' }])).resolves.toEqual({ text: 'answer', provider: 'B' });
        expect(a.calls).toHaveLength(1);
    });

    it('gives up on a provider after the configured transient retries', async () => {
        const p = scripted('Down', [new ProviderHttpError('HTTP 503', 503)]);
        useProviders(p);
        await expect(llmRouter.generate([{ role: 'user', content: 'x' }])).rejects.toThrow(/All configured LLM providers failed/);
        expect(p.calls).toHaveLength(3); // first try + 2 retries
    });

    it('retries a stream that fails before its first token', async () => {
        const p = scripted('Flaky', [new TypeError('fetch failed'), 'Paris là thủ đô của Pháp [1].']);
        useProviders(p);
        const { text } = await streamText('Thủ đô của Pháp là gì?');
        expect(text).toBe('Paris là thủ đô của Pháp [1].');
        expect(p.calls).toHaveLength(2);
    });

    it('discards a Chinese reply to a Vietnamese question and re-asks with a language reminder', async () => {
        const p = scripted('Qwen', ['文档未提供此信息。[1]和[2]段落主要讨论了巴黎', 'Tài liệu không đề cập thông tin này.']);
        useProviders(p);
        const { text } = await streamText('Kinh tế xung quanh kinh đô ánh sáng mạnh về gì?');
        expect(text).toBe('Tài liệu không đề cập thông tin này.');
        expect(p.calls).toHaveLength(2);
        expect(p.calls[1][0].content).toMatch(/Reply only in Vietnamese/);
    });

    it('treats an English reply to a Vietnamese question as a slip too', async () => {
        const p = scripted('Qwen', ['The document does not provide this information.', 'Tài liệu không cung cấp thông tin này.']);
        useProviders(p);
        const { text } = await streamText('Ai là tổng thống Pháp năm 2030?');
        expect(text).toBe('Tài liệu không cung cấp thông tin này.');
        expect(p.calls).toHaveLength(2);
    });

    it('after two re-asks, sends a notice in the question language instead of the wrong-language reply', async () => {
        const p = scripted('Qwen', ['巴黎是法国的首都，位于塞纳河畔。']);
        useProviders(p);
        const { text } = await streamText('Thủ đô của Pháp là gì?');
        expect(text).toMatch(/^Xin lỗi/);
        expect(text).not.toMatch(/[一-鿿]/);
        expect(p.calls).toHaveLength(3);
    });

    it('leaves English questions answered in English alone', async () => {
        const p = scripted('Model', ['Paris is the capital of France [1].']);
        useProviders(p);
        await expect(streamText('What is the capital of France?')).resolves.toMatchObject({ text: 'Paris is the capital of France [1].' });
        expect(p.calls).toHaveLength(1);
    });

    it('rewrites full-width citations 【1】 to [1] so the client can link them', async () => {
        useProviders(scripted('GptOss', ['Alex Ferguson managed Manchester United from 1986 to 2013【1】.']));
        await expect(streamText('When did Alex Ferguson manage Manchester United?')).resolves.toMatchObject({
            text: 'Alex Ferguson managed Manchester United from 1986 to 2013[1].',
        });
    });

    it('rewrites a full-width citation split across stream chunks', async () => {
        const provider = scripted('GptOss', ['']);
        provider.generateStream = async function* () {
            yield* ['Tata Consultancy Services is headquartered in Mumbai, India', '【', '4】', '.'];
        };
        useProviders(provider);
        await expect(streamText('Where is the company headquartered?')).resolves.toMatchObject({
            text: 'Tata Consultancy Services is headquartered in Mumbai, India[4].',
        });
    });

    it('re-asks when an English question gets a Spanish reply', async () => {
        const p = scripted('GptOss', [
            'El compositor de la banda sonora de Alien fue Jerry Goldsmith [1].',
            'The score of Alien was composed by Jerry Goldsmith [1].',
        ]);
        useProviders(p);
        const { text } = await streamText('Who composed the score of Alien?');
        expect(text).toBe('The score of Alien was composed by Jerry Goldsmith [1].');
        expect(p.calls[1][0].content).toMatch(/Reply only in English/);
    });

    it('does not mistake an English answer with French or Spanish names for a slip', async () => {
        const p = scripted('Model', ['The Androscoggin Bank Colisée in Lewiston has 3,677 seats [3].']);
        useProviders(p);
        await streamText('How many seats does the arena have?');
        expect(p.calls).toHaveLength(1);
    });

    it('does not demote a provider for a content-filter refusal: the next question still goes to it', async () => {
        const hefu = scripted('HeFU', [new ProviderHttpError('content filter: inappropriate content', 451), 'Paris [1].']);
        const groq = scripted('Groq', ['fallback answer', 'fallback answer']);
        useProviders(hefu, groq);

        await expect(streamText('Thủ đô của Pháp?')).resolves.toMatchObject({ text: 'fallback answer' });
        await expect(streamText('Thủ đô của Pháp?')).resolves.toMatchObject({ text: 'Paris [1].' });
        expect(hefu.calls).toHaveLength(2);
    });

    it('streams short replies that never reach the language-check length', async () => {
        useProviders(scripted('Short', ['Paris [1].']));
        await expect(streamText('Thủ đô của Pháp?')).resolves.toMatchObject({ text: 'Paris [1].' });
    });
});

describe('extractWindowGraph gate', () => {
    afterEach(() => jest.restoreAllMocks());

    it('retries a window whose reply is not valid JSON, sampling more freely with a format reminder', async () => {
        const spy = jest
            .spyOn(llmRouter, 'generate')
            .mockResolvedValueOnce({ text: '{"entities": [{"name": "Paris", "type"', provider: 'mock' })
            .mockResolvedValueOnce({ text: '{"entities":[{"name":"Paris","type":"city","description":""}],"relations":[]}', provider: 'mock' });

        const graph = await extractWindowGraph('Paris is the capital of France.', []);

        expect(graph.entities.map((e) => e.name)).toEqual(['Paris']);
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy.mock.calls[1][1]?.temperature).toBeGreaterThan(spy.mock.calls[0][1]?.temperature ?? 0);
        expect(spy.mock.calls[1][0][0].content).toMatch(/valid JSON object/);
    });

    it('retries a window the model aborted in a repetition loop', async () => {
        const spy = jest
            .spyOn(llmRouter, 'generate')
            .mockRejectedValueOnce(new Error('All configured LLM providers failed. Ollama: prediction aborted, token repeat limit reached'))
            .mockResolvedValueOnce({ text: '{"entities":[],"relations":[]}', provider: 'mock' });

        await expect(extractWindowGraph('Some text.', [])).resolves.toEqual({ entities: [], relations: [] });
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('does not loop: a second unusable reply fails the window', async () => {
        jest.spyOn(llmRouter, 'generate').mockResolvedValue({ text: 'not json', provider: 'mock' });
        await expect(extractWindowGraph('Some text.', [])).rejects.toThrow(/unparseable JSON/);
    });
});
