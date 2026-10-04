/**
 * Answer generation and scoring shared by the experiments that read the
 * model's answers (2: single book, 3: KG-Series). Scoring is deterministic,
 * against the datasets' own annotations; there is no LLM judge.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { GENERATOR } from './local-model';
import { llmRouter } from '../../src/llm/router';
import { LLMMessage } from '../../src/llm/providers/types';
import { RESULTS_DIR } from './shared';

// ------------------------------------------------------------------ cache

const CACHE_FILE = path.join(RESULTS_DIR, 'answer-cache.jsonl');

const cache = new Map<string, { answer: string; model: string }>();
if (fs.existsSync(CACHE_FILE)) {
    for (const line of fs.readFileSync(CACHE_FILE, 'utf-8').split('\n').filter(Boolean)) {
        const { key, value } = JSON.parse(line);
        cache.set(key, value);
    }
}

/**
 * Generates an answer at temperature 0, cached by the exact prompt sent: a
 * change to the system prompt, the retrieved passages or the graph facts makes
 * a new key, so a re-run never reuses an answer to a different prompt.
 * `label` (book, condition, question) only makes the cache file readable.
 */
export async function generateAnswer(label: string, messages: LLMMessage[]): Promise<{ answer: string; model: string }> {
    const promptHash = createHash('sha1').update(JSON.stringify(messages)).digest('hex');
    const key = `${label}|${GENERATOR}|${promptHash}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const result = await llmRouter.generate(messages, { temperature: 0 });
    const value = { answer: result.text, model: GENERATOR };
    cache.set(key, value);
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.appendFileSync(CACHE_FILE, JSON.stringify({ key, value }) + '\n');
    return value;
}

// ---------------------------------------------------------------- scoring

/** SQuAD/HotpotQA answer normalisation; English articles are only removed for English. */
export function normalizeAnswer(s: string, language: 'en' | 'vi'): string {
    let t = s.normalize('NFC').toLowerCase().replace(/\[\d+(?:\s*[,;]\s*\d+)*\]/g, ' ');
    t = t.replace(/[\p{P}\p{S}]/gu, ' ');
    if (language === 'en') t = t.replace(/\b(a|an|the)\b/g, ' ');
    return t.replace(/\s+/g, ' ').trim();
}

export function tokenF1(prediction: string, gold: string, language: 'en' | 'vi'): number {
    const p = normalizeAnswer(prediction, language).split(' ').filter(Boolean);
    const g = normalizeAnswer(gold, language).split(' ').filter(Boolean);
    if (p.length === 0 || g.length === 0) return Number(p.length === g.length);
    const counts = new Map<string, number>();
    for (const t of g) counts.set(t, (counts.get(t) ?? 0) + 1);
    let common = 0;
    for (const t of p) {
        const c = counts.get(t) ?? 0;
        if (c > 0) {
            common++;
            counts.set(t, c - 1);
        }
    }
    if (common === 0) return 0;
    const precision = common / p.length;
    const recall = common / g.length;
    return (2 * precision * recall) / (precision + recall);
}

/** The reference answer appears in the answer, after normalisation. */
export function containsAnswer(answer: string, golds: string[], language: 'en' | 'vi'): boolean {
    const a = ` ${normalizeAnswer(answer, language)} `;
    return golds.some((g) => {
        const n = normalizeAnswer(g, language);
        return n.length > 0 && a.includes(` ${n} `);
    });
}

const ABSTAIN = [
    /\b(not (mentioned|provided|stated|specified|included|available|supported|found|given|covered|contain)|no (information|mention|details?)|does(n't| not) (say|mention|state|specify|contain|provide|include|explain|indicate|describe)|cannot (find|determine|answer|be determined)|can't (find|determine|answer)|unable to|(do not|don't) know|not enough information|insufficient)\b/i,
    /(không (được )?(đề cập|nêu|cung cấp|nhắc|chứa|có thông tin|có dữ liệu|tìm thấy|xác định|thể (xác định|trả lời|tìm))|chưa (được )?(đề cập|nêu)|không rõ|không biết|không đủ thông tin|thiếu thông tin)/i,
    // qwen2.5 sometimes answers in Chinese whatever the question's language; its refusals count as refusals.
    // Simplified and traditional forms of "not mentioned / not provided / no information about / cannot answer".
    /(并未|並未|无法|無法|未(明确|具体)?(提供|提及|提到|说明|指出|涉及)|没有(直接|具体|明确)?(提及|提到|提供|说明|关于|相关|比较)|沒有(直接|具體|明確)?(提及|提到|提供|說明|關於|相關|比較))/,
];

/** The answer declines: the document does not give the information. */
export const abstained = (answer: string) => ABSTAIN.some((re) => re.test(answer));

/** Answer written in a CJK script, which no question in these datasets is written in. */
export const wrongLanguage = (answer: string) => /[㐀-鿿]/.test(answer);
