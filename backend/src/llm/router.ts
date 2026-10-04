import { GenerateOptions, LLMMessage, LLMProvider, ProviderHttpError } from './providers/types';
import { OpenAiCompatibleProvider } from './providers/openAiCompatible';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { isLanguageSlip, isTransientLLMError, languageFailureNotice, questionLanguage, sleep, TRANSIENT_RETRY_DELAYS_MS } from './retry';

/** Anything with retrievable text — accepts both RetrievedChunk and Citation shapes. */
interface ContextPassage {
    text: string;
}

const HEALTH_CACHE_TTL_MS = 30_000;
/** Non-space characters of a streamed reply held back while its language is checked (a few hundred ms of output). */
const LANGUAGE_CHECK_CHARS = 24;
/** Re-asks after a reply in the wrong language, before giving up with a notice. */
const LANGUAGE_RETRIES = 2;

/**
 * Some models (gpt-oss on Groq) cite as 【1】; the client and the cited-passage check expect [1].
 * A marker can arrive split across stream chunks ("【", "4】"), so an unclosed one is held back
 * until it closes.
 */
class CitationNormalizer {
    private pending = '';

    push(delta: string): string {
        this.pending += delta;
        const open = this.pending.lastIndexOf('【');
        if (open > this.pending.lastIndexOf('】') && this.pending.length - open < 24) {
            const ready = this.pending.slice(0, open);
            this.pending = this.pending.slice(open);
            return normalizeCitations(ready);
        }
        const ready = this.pending;
        this.pending = '';
        return normalizeCitations(ready);
    }

    flush(): string {
        const rest = this.pending;
        this.pending = '';
        return normalizeCitations(rest);
    }
}

function normalizeCitations(text: string): string {
    return text.replace(/【(\d+)(?:†[^】]*)?】/g, '[$1]');
}

function withLanguageReminder(messages: LLMMessage[], language: string): LLMMessage[] {
    const reminder = `Reply only in ${language}, the language the question is written in. Do not use Chinese.`;
    return messages.map((m) => (m.role === 'system' ? { ...m, content: `${m.content} ${reminder}` } : m));
}

/** Every candidate failed. `retryAfterMs` is the shortest rate-limit wait any of them reported, if one did. */
export class LLMUnavailableError extends Error {
    constructor(message: string, public retryAfterMs?: number) {
        super(message);
    }
}

/**
 * Priority-ordered, health-checked LLM router (ADR-07).
 *
 * Order: operator-configured providers (in the order listed below) -> Gemini
 * free tier -> Groq. A provider whose request fails is demoted to the back of
 * the order for a short TTL, and the request fails over to the next
 * candidate. Liveness probes are only sent by the diagnostic status route.
 */
class LLMRouter {
    private providers: LLMProvider[];
    private healthCache = new Map<string, { ok: boolean; expiresAt: number }>();

    constructor() {
        // Tier 1: operator-supplied providers, all free-trial-friendly, OpenAI-compatible
        // except Anthropic. Priority order is deliberate: fastest/most-generous free
        // trials first.
        const operatorProviders: LLMProvider[] = [
            // Self-hosted model via Ollama's OpenAI-compatible API, first when configured:
            // no quota, so it suits local development and offline evaluation. Ollama needs
            // no key; any non-empty value marks the provider as configured.
            new OpenAiCompatibleProvider({
                name: 'Ollama',
                tier: 'operator',
                baseUrl: process.env.OLLAMA_BASE_URL ? `${process.env.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1/chat/completions` : '',
                apiKey: process.env.OLLAMA_BASE_URL ? 'ollama' : undefined,
                model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
                // Ollama constrains decoding to valid JSON in this mode; small local models need it.
                jsonMode: true,
            }),
            // HeFU: paid OpenAI-compatible gateway (pay-as-you-go, USD). Chat uses a reasoning
            // model (deepseek-v4-flash; its thinking arrives in `reasoning_content`, which is not
            // read). Graph extraction uses a plain instruction model: on a 6000-char window the
            // reasoning model timed out three times in a row, deepseek-v3 answered in ~25s.
            new OpenAiCompatibleProvider({
                name: 'HeFU',
                tier: 'operator',
                baseUrl: 'https://hefu.hk/api/v1/chat/completions',
                apiKey: process.env.HEFU_API_KEY,
                model: process.env.HEFU_MODEL || 'deepseek-v4-flash',
                jsonModel: process.env.HEFU_GRAPH_MODEL || 'deepseek-v3',
            }),
            new OpenAiCompatibleProvider({
                name: 'Cerebras',
                tier: 'operator',
                baseUrl: 'https://api.cerebras.ai/v1/chat/completions',
                apiKey: process.env.CEREBRAS_API_KEY,
                model: process.env.CEREBRAS_MODEL || 'llama-3.3-70b',
            }),
            new OpenAiCompatibleProvider({
                name: 'SambaNova',
                tier: 'operator',
                baseUrl: 'https://api.sambanova.ai/v1/chat/completions',
                apiKey: process.env.SAMBANOVA_API_KEY,
                model: process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.3-70B-Instruct',
            }),
            new OpenAiCompatibleProvider({
                name: 'Azure OpenAI',
                tier: 'operator',
                baseUrl: process.env.AZURE_OPENAI_ENDPOINT
                    ? `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=2024-06-01`
                    : '',
                apiKey: process.env.AZURE_OPENAI_API_KEY,
                model: process.env.AZURE_OPENAI_DEPLOYMENT || '',
                authHeader: 'api-key',
            }),
            new OpenAiCompatibleProvider({
                name: 'OpenAI',
                tier: 'operator',
                baseUrl: 'https://api.openai.com/v1/chat/completions',
                apiKey: process.env.OPENAI_API_KEY,
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            }),
            new AnthropicProvider(),
            new OpenAiCompatibleProvider({
                name: 'Mistral',
                tier: 'operator',
                baseUrl: 'https://api.mistral.ai/v1/chat/completions',
                apiKey: process.env.MISTRAL_API_KEY,
                model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
            }),
            new OpenAiCompatibleProvider({
                name: 'OpenRouter',
                tier: 'operator',
                baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
                apiKey: process.env.OPENROUTER_API_KEY,
                model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
            }),
        ];

        const gemini = new GeminiProvider();

        const groq = new OpenAiCompatibleProvider({
            name: 'Groq',
            tier: 'groq',
            baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
            apiKey: process.env.GROQ_API_KEY,
            // Llama models are no longer offered to every Groq account; GPT-OSS is.
            // Groq's free tier meters each model separately (8K tokens/min each),
            // so the fallbacks also serve as extra capacity when one is throttled.
            model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
            fallbackModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
            // Reasoning tokens count against max_tokens (and the minute quota): keep them small or hidden.
            modelParams: (model) =>
                /gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : /qwen/i.test(model) ? { reasoning_format: 'hidden' } : {},
        });

        this.providers = [...operatorProviders, gemini, groq];
    }

    /** Health status for every configured provider, for the /api/system/llm-status diagnostic route. */
    async statusReport(): Promise<Array<{ name: string; tier: string; configured: boolean; healthy: boolean | null }>> {
        return Promise.all(
            this.providers.map(async (p) => ({
                name: p.name,
                tier: p.tier,
                configured: p.isConfigured(),
                healthy: p.isConfigured() ? await this.isHealthy(p) : null,
            }))
        );
    }

    private async isHealthy(provider: LLMProvider): Promise<boolean> {
        const cached = this.healthCache.get(provider.name);
        if (cached && cached.expiresAt > Date.now()) return cached.ok;

        const ok = await provider.checkHealth();
        this.healthCache.set(provider.name, { ok, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS });
        return ok;
    }

    /**
     * Configured providers in priority order, with any that failed in the last
     * HEALTH_CACHE_TTL_MS moved to the back. No liveness probe is sent first:
     * free-tier keys are capped per request, so a probe would halve the quota.
     */
    private candidates(): LLMProvider[] {
        const configured = this.providers.filter((p) => p.isConfigured());
        const recentlyFailed = (p: LLMProvider) => {
            const cached = this.healthCache.get(p.name);
            return Boolean(cached && !cached.ok && cached.expiresAt > Date.now());
        };
        return [...configured.filter((p) => !recentlyFailed(p)), ...configured.filter(recentlyFailed)];
    }

    /**
     * Prompt = hard context (selected text) + knowledge-graph facts + numbered
     * passages. The model must cite passages as [n] so each statement can be
     * traced to its source, and the graph facts only connect entities: every
     * claim still has to rest on a passage.
     */
    buildMessages(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: ContextPassage[],
        graphFacts: string[] = []
    ): LLMMessage[] {
        const context = retrievedChunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
        const userContent = [
            selectedText ? `**Selected text (hard context — the answer must address this passage):**\n${selectedText}` : null,
            graphFacts.length > 0
                ? `**Knowledge graph (relations between entities in the question, extracted from the user's documents):**\n${graphFacts.map((f) => `- ${f}`).join('\n')}`
                : null,
            context ? `**Retrieved document context:**\n${context}` : null,
            `**Question:** ${query}`,
        ]
            .filter(Boolean)
            .join('\n\n');

        return [
            {
                role: 'system',
                content:
                    'You are an assistant embedded in a document reader. Answer strictly from the provided context. ' +
                    'If the selected text is present, treat it as mandatory context the answer must engage with; ' +
                    'a request such as "summarise this passage", "explain the difficult concepts" or "translate" applies to the selected text itself. ' +
                    'Cite the numbered passages you rely on as [1], [2] right after the statement they support; ' +
                    'cite only passages that actually state what you claim. The selected text needs no marker: never write "[selected text]". ' +
                    'Use the knowledge-graph relations only to connect entities across passages; never state a fact that no passage or the selected text supports. ' +
                    'If the context does not contain the answer, say that the document does not provide this information instead of guessing. ' +
                    'Write the whole answer in the language of the question, even when the passages are in another language. Be concise.',
            },
            { role: 'user', content: userContent },
        ];
    }

    /**
     * Non-streaming generation, used by the knowledge-extraction worker. A
     * transient failure (5xx, timeout, dropped connection) is re-sent to the
     * same provider after a short wait before failing over to the next one.
     */
    async generate(messages: LLMMessage[], options?: GenerateOptions): Promise<{ text: string; provider: string }> {
        const errors: string[] = [];
        const waits: number[] = [];
        for (const provider of this.candidates()) {
            for (let attempt = 0; ; attempt++) {
                try {
                    const text = await provider.generate(messages, options);
                    if (text?.trim()) return { text, provider: provider.name };
                    errors.push(`${provider.name}: empty response`);
                    break;
                } catch (err: any) {
                    if (isTransientLLMError(err) && attempt < TRANSIENT_RETRY_DELAYS_MS.length) {
                        console.warn(`[llm] ${provider.name} transient failure, retry ${attempt + 1}: ${err?.message || err}`);
                        await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt]);
                        continue;
                    }
                    errors.push(`${provider.name}: ${err?.message || err}`);
                    if (err instanceof ProviderHttpError && err.retryAfterMs !== undefined) waits.push(err.retryAfterMs);
                    this.markFailed(provider, err);
                    break;
                }
            }
        }
        throw new LLMUnavailableError(this.noProviderError(errors), waits.length > 0 ? Math.min(...waits) : undefined);
    }

    /** RAG-aware generation entry point. */
    async generateAnswer(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: ContextPassage[],
        graphFacts: string[] = []
    ): Promise<{ text: string; provider: string }> {
        return this.generate(this.buildMessages(query, selectedText, retrievedChunks, graphFacts));
    }

    /**
     * Streaming RAG generation with three gates, all applied before anything
     * reaches the client (a partial answer cannot be silently restarted):
     *  - transient failure before the first token: re-send to the same provider after a wait;
     *  - persistent failure: fail over to the next provider;
     *  - language slip (a Chinese reply, or a reply with no Vietnamese in it, to a Vietnamese
     *    question): the opening of the reply is held back until LANGUAGE_CHECK_CHARS; on a slip
     *    the request is re-sent with an explicit language instruction, up to LANGUAGE_RETRIES
     *    times, after which a short notice in the question's language replaces the reply.
     */
    async *generateAnswerStream(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: ContextPassage[],
        graphFacts: string[] = []
    ): AsyncGenerator<{ delta?: string; provider?: string; done?: boolean }> {
        const baseMessages = this.buildMessages(query, selectedText, retrievedChunks, graphFacts);
        const errors: string[] = [];
        let messages = baseMessages;
        let languageRetries = 0;

        for (const provider of this.candidates()) {
            let transientRetries = 0;
            for (;;) {
                let yieldedAny = false;
                let held = '';
                let slipped = false;
                const citations = new CitationNormalizer();
                try {
                    yield { provider: provider.name };
                    for await (const delta of provider.generateStream(messages)) {
                        const text = citations.push(delta);
                        if (!text) continue;
                        if (yieldedAny) {
                            yield { delta: text };
                            continue;
                        }
                        held += text;
                        const enough = held.replace(/\s/g, '').length >= LANGUAGE_CHECK_CHARS;
                        if (isLanguageSlip(query, held, enough)) {
                            slipped = true;
                            break; // closes the provider stream
                        }
                        if (enough) {
                            yieldedAny = true;
                            yield { delta: held };
                        }
                    }
                    if (slipped) {
                        if (languageRetries < LANGUAGE_RETRIES) {
                            languageRetries++;
                            console.warn(`[llm] ${provider.name} answered in another language; retry ${languageRetries} with a language reminder`);
                            messages = withLanguageReminder(baseMessages, questionLanguage(query));
                            continue;
                        }
                        console.warn(`[llm] ${provider.name} still answered in another language; sending a notice instead`);
                        yield { delta: languageFailureNotice(query) };
                        yield { done: true };
                        return;
                    }
                    const tail = citations.flush();
                    if (!yieldedAny && held + tail) yield { delta: held + tail };
                    else if (tail) yield { delta: tail };
                    yield { done: true };
                    return;
                } catch (err: any) {
                    if (yieldedAny) throw err; // partial output already sent — cannot silently retry
                    if (isTransientLLMError(err) && transientRetries < TRANSIENT_RETRY_DELAYS_MS.length) {
                        console.warn(`[llm] ${provider.name} stream failed before output, retry ${transientRetries + 1}: ${err?.message || err}`);
                        await sleep(TRANSIENT_RETRY_DELAYS_MS[transientRetries++]);
                        continue;
                    }
                    errors.push(`${provider.name}: ${err?.message || err}`);
                    this.markFailed(provider, err);
                    break;
                }
            }
        }
        throw new Error(this.noProviderError(errors));
    }

    /**
     * Demotes a provider that failed, for HEALTH_CACHE_TTL_MS. A content-filter refusal (451) is about
     * one request's text, not the provider: demoting it would send the next questions elsewhere.
     */
    private markFailed(provider: LLMProvider, err: unknown): void {
        if (err instanceof ProviderHttpError && err.status === 451) return;
        this.healthCache.set(provider.name, { ok: false, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS });
    }

    private noProviderError(errors: string[]): string {
        if (errors.length === 0) {
            return 'No LLM provider is configured. Set at least one provider API key in backend/.env (see .env.example).';
        }
        return `All configured LLM providers failed. ${errors.join(' | ')}`;
    }
}

export const llmRouter = new LLMRouter();
