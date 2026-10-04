/**
 * Every experiment generates with one local model and never reaches a paid API,
 * so results are reproducible offline and at no cost: Ollama with qwen2.5:7b
 * (override with OLLAMA_BASE_URL / OLLAMA_MODEL). Every hosted provider's key is
 * blanked, which also stops the router from silently falling back to another model.
 *
 * Import this module first in an experiment script: it must run before dotenv
 * loads backend/.env (dotenv never overwrites a variable that is already set)
 * and before the LLM router reads its configuration.
 */
process.env.OLLAMA_BASE_URL ||= 'http://localhost:11434';
process.env.OLLAMA_MODEL ||= 'qwen2.5:7b-8k';

const HOSTED_PROVIDER_KEYS = [
    'HEFU_API_KEY',
    'GROQ_API_KEY',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CEREBRAS_API_KEY',
    'SAMBANOVA_API_KEY',
    'MISTRAL_API_KEY',
    'OPENROUTER_API_KEY',
    'AZURE_OPENAI_API_KEY',
];
for (const key of HOSTED_PROVIDER_KEYS) process.env[key] = '';

/** The generating model, recorded with every cached output. */
export const GENERATOR = `ollama/${process.env.OLLAMA_MODEL}`;
