export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** A non-2xx provider response; `retryAfterMs` is set when the provider says how long a rate limit lasts. */
export class ProviderHttpError extends Error {
    constructor(message: string, public status: number, public retryAfterMs?: number) {
        super(message);
    }
}

/** Reads the wait from a 429: the Retry-After header, else the "try again in 7.5s" hint most vendors put in the body. */
export function parseRetryAfterMs(headers: Headers | undefined, body: string): number | undefined {
    const header = headers?.get?.('retry-after');
    if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
    const match = body.match(/try again in\s+(?:(\d+)m)?([\d.]+)(ms|s)/i);
    if (!match) return undefined;
    const minutes = match[1] ? Number(match[1]) * 60_000 : 0;
    return minutes + Number(match[2]) * (match[3].toLowerCase() === 'ms' ? 1 : 1000);
}

export interface GenerateOptions {
    /** Output budget; structured extraction needs far more than a chat reply or its JSON is cut off. */
    maxTokens?: number;
    temperature?: number;
    /** Ask for a JSON-only response where the provider supports a native switch for it. */
    json?: boolean;
}

/**
 * One chat-completion backend. `tier` groups providers for the router's
 * priority order (see ADR-07): 'operator' providers are configured by the
 * deployment owner, 'gemini' and 'groq' are the two always-attempted free
 * fallbacks.
 */
export interface LLMProvider {
    name: string;
    tier: 'operator' | 'gemini' | 'groq';
    /** Cheap presence check: is a key/URL configured at all? */
    isConfigured(): boolean;
    /** Network liveness probe, used by the router before dispatching a request. */
    checkHealth(): Promise<boolean>;
    generate(messages: LLMMessage[], options?: GenerateOptions): Promise<string>;
    /** Yields text deltas as they arrive, for SSE streaming to the client. */
    generateStream(messages: LLMMessage[]): AsyncGenerator<string>;
}
