import { ProviderHttpError } from './providers/types';

/**
 * Waits before re-sending a request to the same provider after a transient
 * failure. With a single configured provider (a local Ollama, or one paid
 * key) there is nothing to fail over to, so these retries are the only
 * recovery; with several, the router still fails over once they are spent.
 */
export const TRANSIENT_RETRY_DELAYS_MS = (process.env.LLM_RETRY_DELAYS_MS || '1500,5000')
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);

const TRANSIENT_NETWORK = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated|empty stream|network/i;

/**
 * Failures worth re-sending unchanged: server-side errors (e.g. Ollama's 500
 * when the model runs out of GPU memory or aborts on a repetition loop),
 * timeouts and dropped connections. Client errors (400/401/404) would fail
 * the same way again, and 429s are handled by model fallback and Retry-After.
 */
export function isTransientLLMError(err: unknown): boolean {
    if (err instanceof ProviderHttpError) return err.status >= 500 || err.status === 408;
    const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } } | undefined;
    if (!e) return false;
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    return TRANSIENT_NETWORK.test(`${e.message ?? ''} ${e.code ?? ''} ${e.cause?.code ?? ''} ${e.cause?.message ?? ''}`);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Han characters, kana and hangul: a reply in these scripts to a question written without them is a language slip. */
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

/** Letters only Vietnamese uses among Latin-script languages; any real Vietnamese sentence contains some. */
const VIETNAMESE = /[ăâđêôơưàáạảãấầẩẫậắằẳẵặèéẹẻẽếềểễệìíịỉĩòóọỏõốồổỗộớờởỡợùúụủũứừửữựỳýỵỷỹ]/i;

/**
 * Models drift out of the question's language despite the instruction: qwen2.5:7b
 * answered Vietnamese questions in Chinese or English, gpt-oss on Groq answered
 * English ones in Spanish. True when the reply so far is in a CJK script the
 * question does not use, or, once there is enough text to judge (`complete`),
 * when a Vietnamese question gets no Vietnamese letter or an English question
 * gets a reply with Romance-language function words and no English ones.
 */
export function isLanguageSlip(question: string, replySoFar: string, complete = false): boolean {
    if (!CJK.test(question) && CJK.test(replySoFar)) return true;
    if (!complete) return false;
    if (VIETNAMESE.test(question)) return !VIETNAMESE.test(replySoFar);
    // gpt-oss on Groq has answered English questions in Spanish.
    return isEnglish(question) && !isEnglish(replySoFar) && wordCount(replySoFar, ROMANCE_WORDS) >= 2;
}

const ENGLISH_WORDS = /\b(the|a|an|is|was|of|in|and|to|what|who|which|when|where|how|did|does|for|by|from)\b/gi;
const ROMANCE_WORDS = /\b(el|la|los|las|del|fue|que|una|por|con|para|est|une|les|des|pour|qui)\b/gi;

function wordCount(text: string, words: RegExp): number {
    return text.match(words)?.length ?? 0;
}

function isEnglish(text: string): boolean {
    return wordCount(text, ENGLISH_WORDS) > 0 && !VIETNAMESE.test(text);
}

/** Names the question's language for the corrective instruction sent with the retry. */
export function questionLanguage(question: string): string {
    if (VIETNAMESE.test(question)) return 'Vietnamese';
    return isEnglish(question) ? 'English' : 'the language of the question';
}

/** Shown instead of a reply that stayed in the wrong language after every retry. */
export function languageFailureNotice(question: string): string {
    return VIETNAMESE.test(question)
        ? 'Xin lỗi, mô hình chưa trả lời được bằng tiếng Việt cho câu hỏi này. Vui lòng hỏi lại.'
        : 'Sorry, the model could not answer this question in its language. Please ask again.';
}
