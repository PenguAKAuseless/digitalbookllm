export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
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
