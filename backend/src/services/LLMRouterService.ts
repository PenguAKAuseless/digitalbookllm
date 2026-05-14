import axios from 'axios';
import { pipeline } from '@xenova/transformers';
import { RetrievedChunk } from '../types';

interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface LLMProvider {
    name: string;
    isAvailable(): boolean;
    generate(messages: LLMMessage[]): Promise<string>;
}

// ─── Together AI ─────────────────────────────────────────────────────────────
class TogetherAIProvider implements LLMProvider {
    name = 'Together AI';

    isAvailable() {
        const key = process.env.TOGETHER_API_KEY || '';
        return key.length > 0 && key !== 'your_together_api_key_here';
    }

    async generate(messages: LLMMessage[]): Promise<string> {
        const response = await axios.post(
            process.env.TOGETHER_API_URL || 'https://api.together.xyz/v1/chat/completions',
            {
                model: process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
                messages,
                temperature: 0.7,
                max_tokens: 600,
                top_p: 0.9,
            },
            {
                headers: { Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`, 'Content-Type': 'application/json' },
                timeout: 30000,
            }
        );
        return response.data.choices[0].message.content;
    }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────
class OpenAIProvider implements LLMProvider {
    name = 'OpenAI';

    isAvailable() {
        const key = process.env.OPENAI_API_KEY || '';
        return key.length > 0 && key !== 'your_openai_api_key_here';
    }

    async generate(messages: LLMMessage[]): Promise<string> {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                messages,
                temperature: 0.7,
                max_tokens: 600,
            },
            {
                headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                timeout: 30000,
            }
        );
        return response.data.choices[0].message.content;
    }
}

// ─── Anthropic ───────────────────────────────────────────────────────────────
class AnthropicProvider implements LLMProvider {
    name = 'Anthropic';

    isAvailable() {
        const key = process.env.ANTHROPIC_API_KEY || '';
        return key.length > 0 && key !== 'your_anthropic_api_key_here';
    }

    async generate(messages: LLMMessage[]): Promise<string> {
        const system = messages.find((m) => m.role === 'system')?.content || '';
        const userMessages = messages.filter((m) => m.role !== 'system');

        const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
                model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
                max_tokens: 600,
                system,
                messages: userMessages,
            },
            {
                headers: {
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            }
        );
        return response.data.content[0].text;
    }
}

// ─── Groq ─────────────────────────────────────────────────────────────────────
class GroqProvider implements LLMProvider {
    name = 'Groq';

    isAvailable() {
        const key = process.env.GROQ_API_KEY || '';
        return key.length > 0 && key !== 'your_groq_api_key_here';
    }

    async generate(messages: LLMMessage[]): Promise<string> {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
                messages,
                temperature: 0.7,
                max_tokens: 600,
            },
            {
                headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                timeout: 20000,
            }
        );
        return response.data.choices[0].message.content;
    }
}

// ─── Ollama (local) ───────────────────────────────────────────────────────────
class OllamaProvider implements LLMProvider {
    name = 'Ollama';
    private ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    private ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
    private _available: boolean | null = null;

    isAvailable() {
        return Boolean(process.env.OLLAMA_URL?.trim());
    }

    async generate(messages: LLMMessage[]): Promise<string> {
        const response = await axios.post(
            `${this.ollamaUrl}/api/chat`,
            { model: this.ollamaModel, messages, stream: false },
            { timeout: 60000 }
        );
        return response.data.message.content;
    }
}

// ─── Xenova local generation (always available, CPU) ─────────────────────────
class XenovaGenerationProvider implements LLMProvider {
    name = 'Xenova (local)';
    private generator: any = null;
    private modelName = process.env.XENOVA_GENERATION_MODEL || 'Xenova/flan-t5-base';

    isAvailable() {
        return process.env.XENOVA_FALLBACK !== 'false';
    }

    private async initialize() {
        if (!this.generator) {
            console.log(`[Xenova] Loading generation model: ${this.modelName}`);
            this.generator = await pipeline('text2text-generation', this.modelName);
            console.log('[Xenova] Generation model loaded');
        }
    }

    async generate(messages: LLMMessage[]): Promise<string> {
        await this.initialize();
        const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
        const userMsg = messages.find((m) => m.role === 'user')?.content || '';
        const prompt = `${systemMsg}\n\n${userMsg}`;

        const output = await this.generator(prompt, {
            max_new_tokens: 400,
            num_beams: 2,
            no_repeat_ngram_size: 4,
        });

        const text = Array.isArray(output) ? output[0]?.generated_text || '' : output?.generated_text || '';

        if (isLikelyGarbage(text)) {
            throw new Error(
                'Local model produced low-quality (repetitive) output. This question is too complex for the local Xenova model.'
            );
        }
        return text;
    }
}

function isLikelyGarbage(text: string): boolean {
    if (!text) return true;
    const trimmed = text.trim();
    if (trimmed.length < 5) return true;

    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length < 8) return false;

    const seq: Record<string, number> = {};
    for (let i = 0; i <= words.length - 4; i++) {
        const k = words.slice(i, i + 4).join(' ');
        seq[k] = (seq[k] || 0) + 1;
    }
    return Object.values(seq).some((c) => c >= 3);
}

// ─── Router ───────────────────────────────────────────────────────────────────
class LLMRouterService {
    private providers: LLMProvider[] = [
        new TogetherAIProvider(),
        new OpenAIProvider(),
        new AnthropicProvider(),
        new GroqProvider(),
        new OllamaProvider(),
        new XenovaGenerationProvider(),
    ];

    async generateResponse(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: RetrievedChunk[]
    ): Promise<{ text: string; provider: string }> {
        const messages = this.buildMessages(query, selectedText, retrievedChunks);
        const attempted: string[] = [];
        const errors: string[] = [];

        for (const provider of this.providers) {
            if (!provider.isAvailable()) continue;
            attempted.push(provider.name);

            try {
                console.log(`[LLM] Trying provider: ${provider.name}`);
                const response = await provider.generate(messages);
                if (!response || response.trim().length < 3) {
                    throw new Error(`${provider.name} returned empty response`);
                }
                console.log(`[LLM] Success with: ${provider.name}`);
                return { text: response, provider: provider.name };
            } catch (error: any) {
                const msg = error?.message || String(error);
                console.warn(`[LLM] Provider "${provider.name}" failed:`, msg);
                errors.push(`${provider.name}: ${msg}`);
            }
        }

        if (attempted.length === 0) {
            throw new Error(
                'No LLM provider is configured. Set at least one in backend/.env: TOGETHER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, or OLLAMA_URL.'
            );
        }

        throw new Error(
            `All ${attempted.length} configured LLM provider(s) failed (${attempted.join(', ')}). For better answers, add an API key for Together AI, OpenAI, Anthropic, or Groq in backend/.env, or run Ollama locally. Errors: ${errors.join(' | ')}`
        );
    }

    private buildMessages(
        query: string,
        selectedText: string | undefined,
        retrievedChunks: RetrievedChunk[]
    ): LLMMessage[] {
        const context = retrievedChunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');

        const userContent = [
            selectedText ? `**Selected text (primary context):**\n${selectedText}` : null,
            context ? `**Document context:**\n${context}` : null,
            `**Question:** ${query}`,
        ]
            .filter(Boolean)
            .join('\n\n');

        return [
            {
                role: 'system',
                content:
                    'You are a helpful AI assistant for document analysis and learning. Answer questions based strictly on the provided document context. If the answer is not in the context, say so clearly. Be concise and educational.',
            },
            { role: 'user', content: userContent },
        ];
    }
}

export const llmRouterService = new LLMRouterService();
