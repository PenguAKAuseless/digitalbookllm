import { GenerateOptions, LLMMessage, LLMProvider, ProviderHttpError } from './providers/types';
import { OpenAiCompatibleProvider } from './providers/openAiCompatible';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';

/** Anything with retrievable text — accepts both RetrievedChunk and Citation shapes. */
interface ContextPassage {
    text: string;
}

const HEALTH_CACHE_TTL_MS = 30_000;

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

    private buildMessages(query: string, selectedText: string | undefined, retrievedChunks: ContextPassage[]): LLMMessage[] {
        const context = retrievedChunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
        const userContent = [
            selectedText ? `**Selected text (hard context — the answer must address this passage):**\n${selectedText}` : null,
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
                    'If the selected text is present, treat it as mandatory context the answer must engage with. ' +
                    'If the answer is not supported by the context, say so. Be concise.',
            },
            { role: 'user', content: userContent },
        ];
    }

    /** Non-streaming generation, used by the knowledge-extraction worker. */
    async generate(messages: LLMMessage[], options?: GenerateOptions): Promise<{ text: string; provider: string }> {
        const errors: string[] = [];
        const waits: number[] = [];
        for (const provider of this.candidates()) {
            try {
                const text = await provider.generate(messages, options);
                if (text?.trim()) return { text, provider: provider.name };
            } catch (err: any) {
                errors.push(`${provider.name}: ${err?.message || err}`);
                if (err instanceof ProviderHttpError && err.retryAfterMs !== undefined) waits.push(err.retryAfterMs);
                this.healthCache.set(provider.name, { ok: false, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS });
            }
        }
        throw new LLMUnavailableError(this.noProviderError(errors), waits.length > 0 ? Math.min(...waits) : undefined);
    }

    /** RAG-aware generation entry point. */
    async generateAnswer(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: ContextPassage[]
    ): Promise<{ text: string; provider: string }> {
        return this.generate(this.buildMessages(query, selectedText, retrievedChunks));
    }

    /**
     * Streaming RAG generation with failover: if the first healthy provider
     * throws before yielding anything, the router falls through to the next
     * one automatically (mid-stream failures after partial output are
     * surfaced to the caller, since a partial answer cannot be silently
     * restarted).
     */
    async *generateAnswerStream(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: ContextPassage[]
    ): AsyncGenerator<{ delta?: string; provider?: string; done?: boolean }> {
        const messages = this.buildMessages(query, selectedText, retrievedChunks);
        const errors: string[] = [];

        for (const provider of this.candidates()) {
            let yieldedAny = false;
            try {
                yield { provider: provider.name };
                for await (const delta of provider.generateStream(messages)) {
                    yieldedAny = true;
                    yield { delta };
                }
                yield { done: true };
                return;
            } catch (err: any) {
                errors.push(`${provider.name}: ${err?.message || err}`);
                this.healthCache.set(provider.name, { ok: false, expiresAt: Date.now() + HEALTH_CACHE_TTL_MS });
                if (yieldedAny) throw err; // partial output already sent — cannot silently retry
            }
        }
        throw new Error(this.noProviderError(errors));
    }

    private noProviderError(errors: string[]): string {
        if (errors.length === 0) {
            return 'No LLM provider is configured. Set at least one provider API key in backend/.env (see .env.example).';
        }
        return `All configured LLM providers failed. ${errors.join(' | ')}`;
    }
}

export const llmRouter = new LLMRouter();
