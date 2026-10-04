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
 * Small local models (qwen2.5:7b in our evaluation) sometimes answer a
 * Vietnamese question in Chinese or English despite the instruction. True when
 * the reply so far is in a CJK script the question does not use, or when a
 * Vietnamese question gets a reply opening (`complete` = enough text to judge)
 * without a single Vietnamese letter.
 */
export function isLanguageSlip(question: string, replySoFar: string, complete = false): boolean {
    if (!CJK.test(question) && CJK.test(replySoFar)) return true;
    return complete && VIETNAMESE.test(question) && !VIETNAMESE.test(replySoFar);
}

/** Names the question's language for the corrective instruction sent with the retry. */
export function questionLanguage(question: string): string {
    return VIETNAMESE.test(question) ? 'Vietnamese' : 'the language of the question';
}

/** Shown instead of a reply that stayed in the wrong language after every retry. */
export function languageFailureNotice(question: string): string {
    return VIETNAMESE.test(question)
        ? 'Xin lỗi, mô hình chưa trả lời được bằng tiếng Việt cho câu hỏi này. Vui lòng hỏi lại.'
        : 'Sorry, the model could not answer this question in its language. Please ask again.';
}
