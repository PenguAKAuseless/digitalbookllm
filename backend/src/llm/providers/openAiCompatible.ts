import { GenerateOptions, LLMMessage, LLMProvider, parseRetryAfterMs, ProviderHttpError } from './types';

export interface OpenAiCompatibleConfig {
    name: string;
    tier: 'operator' | 'gemini' | 'groq';
    baseUrl: string;
    apiKey: string | undefined;
    model: string;
    /**
     * Further models on the same key, in preference order. Used when `model`
     * is rejected as unknown (404) and, since free tiers meter each model
     * separately, when it is rate limited (429).
     */
    fallbackModels?: string[];
    /** Vendor-specific request fields for a given model (e.g. reasoning controls). */
    modelParams?: (model: string) => Record<string, unknown>;
    /** Header carrying the key. OpenAI-family APIs use Authorization: Bearer, Azure uses api-key. */
    authHeader?: 'authorization' | 'api-key';
    /** Sends `response_format: json_object` when a caller asks for JSON (only where the vendor honours it). */
    jsonMode?: boolean;
    /**
     * Model tried first for JSON requests (knowledge-graph extraction). A reasoning model that
     * suits chat can spend minutes thinking over a 6000-character window, where a plain
     * instruction model returns the JSON in seconds.
     */
    jsonModel?: string;
    timeoutMs?: number;
}

/** Non-chat models some vendors list under /models, never a sensible fallback. */
const NON_CHAT_MODEL = /whisper|guard|safeguard|tts|embed|playai|orpheus|audio|moderation/i;
/** Cooldown for a 429 that does not say how long to wait. */
const DEFAULT_RATE_LIMIT_MS = 60_000;
/** Default wait for a provider's response headers; a slow local model on a 6000-char window needs well over a minute. */
const REQUEST_TIMEOUT_MS = parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || '180000');

/**
 * Chat-completions provider for any OpenAI-schema-compatible endpoint:
 * OpenAI, Groq, Cerebras, SambaNova, Mistral, OpenRouter, Azure OpenAI.
 * Handles both blocking and SSE-streamed responses against `POST {baseUrl}`.
 */
export class OpenAiCompatibleProvider implements LLMProvider {
    name: string;
    tier: 'operator' | 'gemini' | 'groq';
    private models: string[];
    private unavailable = new Set<string>();
    private cooldownUntil = new Map<string, number>();
    /** Models that rejected `modelParams` (400); they are sent the plain request from then on. */
    private plainModels = new Set<string>();
    private discoveryDone = false;

    constructor(private cfg: OpenAiCompatibleConfig) {
        this.name = cfg.name;
        this.tier = cfg.tier;
        this.models = [...new Set([cfg.model, ...(cfg.fallbackModels ?? []), ...(cfg.jsonModel ? [cfg.jsonModel] : [])])];
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

    private usableModels(): string[] {
        const now = Date.now();
        return this.models.filter((m) => !this.unavailable.has(m) && (this.cooldownUntil.get(m) ?? 0) <= now);
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
                    model: this.usableModels()[0] ?? this.cfg.model,
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

    /**
     * Bounded by a timeout until the response headers arrive (for a non-streamed
     * call that is the whole generation), so a hung provider fails as a
     * retryable TimeoutError instead of blocking a worker slot forever. A
     * stream, once started, is not cut short.
     */
    private async send(model: string, body: Record<string, unknown>): Promise<Response> {
        const extra = this.plainModels.has(model) ? {} : this.cfg.modelParams?.(model) ?? {};
        const controller = new AbortController();
        const timeoutMs = this.cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
        const timer = setTimeout(() => controller.abort(new DOMException(`${this.name} timed out after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
        try {
            return await fetch(this.cfg.baseUrl, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify({ model, ...extra, ...body }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * POSTs a completion request, walking the model list: a 404 drops the
     * model (and triggers a one-off /models lookup), a 429 puts it on cooldown
     * and moves on to the next one. Throws a 429 carrying the shortest
     * remaining cooldown once every model is throttled.
     */
    private async post(body: Record<string, unknown>, preferredModel?: string): Promise<Response> {
        const tried = new Set<string>();
        let lastError: ProviderHttpError | undefined;

        for (;;) {
            const usable = this.usableModels();
            const order = preferredModel && usable.includes(preferredModel) ? [preferredModel, ...usable] : usable;
            const model = order.find((m) => !tried.has(m));
            if (!model) break;
            tried.add(model);

            let res = await this.send(model, body);
            if (res.status === 400 && this.cfg.modelParams && !this.plainModels.has(model)) {
                this.plainModels.add(model);
                res = await this.send(model, body);
            }
            if (res.ok) return res;

            const text = await res.text();
            const message = `${this.name} HTTP ${res.status} (${model}): ${text}`;
            if (res.status === 404) {
                this.unavailable.add(model);
                await this.discoverModels();
                lastError = new ProviderHttpError(message, 404);
            } else if (res.status === 429) {
                const wait = parseRetryAfterMs(res.headers, text) ?? DEFAULT_RATE_LIMIT_MS;
                this.cooldownUntil.set(model, Date.now() + wait);
                lastError = new ProviderHttpError(message, 429, wait);
            } else {
                throw new ProviderHttpError(message, res.status);
            }
        }

        const now = Date.now();
        const waits = this.models
            .filter((m) => !this.unavailable.has(m))
            .map((m) => (this.cooldownUntil.get(m) ?? 0) - now)
            .filter((ms) => ms > 0);
        if (waits.length > 0) {
            const wait = Math.min(...waits);
            throw new ProviderHttpError(lastError?.message ?? `${this.name}: every model is rate limited`, 429, wait);
        }
        throw lastError ?? new ProviderHttpError(`${this.name}: no usable model for this key`, 404);
    }

    /** Asks the vendor's /models listing what this key may call. Runs at most once per process. */
    private async discoverModels(): Promise<void> {
        if (this.discoveryDone) return;
        this.discoveryDone = true;

        const modelsUrl = this.cfg.baseUrl.replace(/\/chat\/completions(\?.*)?$/, '/models');
        if (modelsUrl === this.cfg.baseUrl || this.cfg.authHeader === 'api-key') return;

        try {
            const res = await fetch(modelsUrl, { headers: this.headers() });
            if (!res.ok) return;
            const data: any = await res.json();
            const available: string[] = (data.data ?? []).map((m: any) => m.id).filter(Boolean);
            for (const m of this.models) if (!available.includes(m)) this.unavailable.add(m);
            if (this.usableModels().length === 0) {
                const other = available.find((id) => !NON_CHAT_MODEL.test(id));
                if (other) this.models.push(other);
            }
            console.warn(`[llm] ${this.name}: models usable with this key: ${this.usableModels().join(', ') || 'none'}`);
        } catch {
            // Keep going with whatever is left in the list.
        }
    }

    async generate(messages: LLMMessage[], options: GenerateOptions = {}): Promise<string> {
        // `response_format` is not honoured uniformly across these vendors, so JSON is enforced by
        // prompt, plus the vendor's JSON mode where the provider is configured with it.
        const res = await this.post({
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 800,
            ...(options.json && this.cfg.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }, options.json ? this.cfg.jsonModel : undefined);
        const data: any = await res.json();
        const content: string = data.choices?.[0]?.message?.content ?? '';
        // Reasoning models that inline their thinking must not leak it into answers or JSON.
        return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    async *generateStream(messages: LLMMessage[]): AsyncGenerator<string> {
        const res = await this.post({ messages, temperature: 0.7, max_tokens: 800, stream: true });
        if (!res.body) throw new Error(`${this.name} returned an empty stream`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
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
                    let parsed: any;
                    try {
                        parsed = JSON.parse(payload);
                    } catch {
                        continue; // malformed keep-alive chunk
                    }
                    // Some servers (Ollama among them) report a failure inside the stream with a 200 status.
                    if (parsed.error) throw new ProviderHttpError(`${this.name} stream error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`, 500);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) yield delta;
                }
            }
        } finally {
            // Runs when the consumer stops early too (e.g. the router's language gate): free the connection.
            Promise.resolve().then(() => reader.cancel()).catch(() => {});
        }
    }
}
