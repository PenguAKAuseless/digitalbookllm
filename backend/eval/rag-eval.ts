/**
 * RAG evaluation harness: seeds a synthetic corpus with known facts, asks
 * each golden question through the real /api/rag/query SSE endpoint, and
 * scores retrieval recall@k, answer keyword coverage, and time-to-first-byte
 * (NFR02.1 target: < 2s). Retrieval metrics are independent of whether an
 * LLM provider is configured — citations are emitted before generation
 * begins (see ragController.queryStream).
 *
 * Usage: BASE_URL=http://localhost:3001 ts-node eval/rag-eval.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const goldenSet = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set.json'), 'utf-8'));

async function json(url: string, init?: RequestInit) {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) } });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function setupCorpus() {
    const email = `rag-eval-${Date.now()}@example.com`;
    const reg = await json(`${BASE_URL}/api/auth/register`, { method: 'POST', body: JSON.stringify({ email, password: 'password123' }) });
    const token = reg.body.data.token as string;

    const ws = await json(`${BASE_URL}/api/workspaces`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'RAG Eval' }),
    });
    const workspaceId = ws.body.data.id as string;

    const form = new FormData();
    form.append('workspaceId', workspaceId);
    form.append('file', new Blob([goldenSet.corpus], { type: 'text/plain' }), 'corpus.txt');
    const upload = await fetch(`${BASE_URL}/api/documents/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const uploadBody: any = await upload.json();
    const documentId = uploadBody.data.documentId as string;

    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const status = await json(`${BASE_URL}/api/documents/${documentId}/status`, { headers: { Authorization: `Bearer ${token}` } });
        if (status.body.data.status === 'READY') break;
        if (status.body.data.status === 'FAILED') throw new Error('Corpus ingestion failed');
    }

    return { token, workspaceId, documentId };
}

interface CaseResult {
    id: string;
    ttfbMs: number;
    retrievalHit: boolean;
    generationHit: boolean | null; // null when no provider was available
    citedKeywords: string[];
}

async function runCase(token: string, workspaceId: string, documentId: string, testCase: any): Promise<CaseResult> {
    const started = Date.now();
    let ttfbMs = -1;
    let citations: Array<{ text: string }> = [];
    let answer = '';

    const res = await fetch(`${BASE_URL}/api/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: testCase.question, workspaceId, documentId }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawAnyEvent = false;
    let generationErrored = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!sawAnyEvent) {
            ttfbMs = Date.now() - started;
            sawAnyEvent = true;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const raw of events) {
            const eventLine = raw.split('\n').find((l) => l.startsWith('event:'));
            const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
            if (!eventLine || !dataLine) continue;
            const event = eventLine.slice(6).trim();
            const data = JSON.parse(dataLine.slice(5).trim());
            if (event === 'citations') citations = data;
            if (event === 'delta') answer += data.text;
            if (event === 'error') generationErrored = true;
        }
    }

    const corpusText = citations.map((c) => c.text).join(' ');
    const retrievalHit = testCase.expectedKeywords.some((kw: string) => corpusText.includes(kw));
    const generationHit = generationErrored ? null : testCase.expectedKeywords.some((kw: string) => answer.includes(kw));

    return { id: testCase.id, ttfbMs, retrievalHit, generationHit, citedKeywords: testCase.expectedKeywords.filter((kw: string) => corpusText.includes(kw)) };
}

async function main() {
    const { token, workspaceId, documentId } = await setupCorpus();
    const results: CaseResult[] = [];
    for (const testCase of goldenSet.cases) {
        results.push(await runCase(token, workspaceId, documentId, testCase));
    }

    const recallAtK = results.filter((r) => r.retrievalHit).length / results.length;
    const generationCases = results.filter((r) => r.generationHit !== null);
    const generationAccuracy = generationCases.length
        ? generationCases.filter((r) => r.generationHit).length / generationCases.length
        : null;
    const ttfbValues = results.map((r) => r.ttfbMs).sort((a, b) => a - b);
    const ttfbP95 = ttfbValues[Math.floor(ttfbValues.length * 0.95)] ?? ttfbValues[ttfbValues.length - 1];

    const report = {
        timestamp: new Date().toISOString(),
        cases: results,
        metrics: {
            'retrieval.recallAtK': recallAtK,
            'generation.keywordAccuracy': generationAccuracy,
            'latency.ttfbP95Ms': ttfbP95,
            'latency.ttfbTargetMs': 2000,
            'latency.ttfbTargetMet': ttfbP95 < 2000,
        },
    };

    fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'results', 'rag-eval-report.json'), JSON.stringify(report, null, 2));

    console.log('\nRAG evaluation report');
    console.log('='.repeat(40));
    for (const r of results) {
        console.log(`${r.id}: retrieval=${r.retrievalHit ? 'HIT' : 'MISS'} generation=${r.generationHit ?? 'n/a (no provider)'} ttfb=${r.ttfbMs}ms`);
    }
    console.log('='.repeat(40));
    console.log(`recall@k: ${(recallAtK * 100).toFixed(0)}%`);
    console.log(`generation keyword accuracy: ${generationAccuracy === null ? 'n/a' : (generationAccuracy * 100).toFixed(0) + '%'}`);
    console.log(`TTFB p95: ${ttfbP95}ms (target < 2000ms: ${ttfbP95 < 2000 ? 'MET' : 'MISSED'})`);
    console.log(`Full report: eval/results/rag-eval-report.json`);
}

main();
