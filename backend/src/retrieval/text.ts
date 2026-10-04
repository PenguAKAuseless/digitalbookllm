/** Text normalisation shared by lexical search and entity matching (works for Vietnamese diacritics). */

export function normalizeText(text: string): string {
    return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

export function tokenize(text: string): string[] {
    return normalizeText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** True if `needle` occurs in `haystack` as whole words. Both must already be normalised. */
export function containsPhrase(haystack: string, needle: string): boolean {
    if (!needle) return false;
    let from = 0;
    for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) return false;
        if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length])) return true;
        from = at + 1;
    }
}
