export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
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
    generate(messages: LLMMessage[]): Promise<string>;
    /** Yields text deltas as they arrive, for SSE streaming to the client. */
    generateStream(messages: LLMMessage[]): AsyncGenerator<string>;
}
