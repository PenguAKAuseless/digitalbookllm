import { BM25Index } from '../../src/retrieval/bm25';
import { reciprocalRankFusion } from '../../src/retrieval/fusion';
import { linkQueryEntities, relationFacts, selectHopEntities } from '../../src/retrieval/graphSignals';
import { containsPhrase, normalizeText } from '../../src/retrieval/text';
import { citedPassageIndices } from '../../src/controllers/ragController';

describe('text helpers', () => {
    it('matches whole words only, including Vietnamese', () => {
        expect(containsPhrase(normalizeText('Thủ đô Paris của Pháp'), 'paris')).toBe(true);
        expect(containsPhrase(normalizeText('Parisian cafés'), 'paris')).toBe(false);
        expect(containsPhrase(normalizeText('Sông Seine chảy qua Paris.'), normalizeText('sông Seine'))).toBe(true);
    });
});

describe('BM25Index', () => {
    it('ranks the chunk with the rare query term first', () => {
        const index = new BM25Index(['the cat sat', 'the dog ran', 'a fractal scaffold for coral larvae']);
        expect(index.search('why fractal scaffolds', 3)[0].index).toBe(2);
        expect(index.search('unrelated words', 3)).toEqual([]);
    });
});

describe('reciprocalRankFusion', () => {
    it('rewards items ranked well by several signals and honours weights', () => {
        const fused = reciprocalRankFusion([
            { ids: ['a', 'b', 'c'], weight: 1 },
            { ids: ['b', 'c', 'a'], weight: 1 },
        ]);
        expect(fused[0].id).toBe('b');
        const weighted = reciprocalRankFusion([
            { ids: ['a', 'b'], weight: 0.1 },
            { ids: ['b', 'a'], weight: 1 },
        ]);
        expect(weighted[0].id).toBe('b');
    });
});

describe('graph signals', () => {
    const entities = [
        { id: 'film', name: 'Big Stone Gap' },
        { id: 'person', name: 'Adriana Trigiani' },
        { id: 'city', name: 'New York City' },
        { id: 'town', name: 'Gap' },
    ];
    const relations = [
        { sourceId: 'film', targetId: 'person', type: 'directed by' },
        { sourceId: 'person', targetId: 'city', type: 'lives in' },
    ];

    it('links entities named in the question and drops names contained in a longer match', () => {
        const linked = linkQueryEntities('Where is the director of Big Stone Gap based?', entities);
        expect(linked.map((l) => l.entity.id)).toEqual(['film']);
    });

    it('links multi-word names by most of their words', () => {
        const linked = linkQueryEntities('What did Trigiani Adriana write?', entities);
        expect(linked[0].entity.id).toBe('person');
        expect(linked[0].score).toBeLessThan(1);
    });

    it('picks the entity one edge away from the question as the bridge, not the question entity itself', () => {
        const seeds = linkQueryEntities('Where is the director of Big Stone Gap based?', entities);
        const hops = selectHopEntities('Where is the director of Big Stone Gap based?', seeds, [], entities, relations, 2);
        expect(hops.map((h) => h.entity.id)).toEqual(['person']);
    });

    it('prefers a bridge that the top first-pass passage also names', () => {
        const extra = [...entities, { id: 'studio', name: 'Altar Identity Studios' }];
        const rels = [...relations, { sourceId: 'film', targetId: 'studio', type: 'produced by' }];
        const seeds = linkQueryEntities('Big Stone Gap', extra);
        const context = [normalizeText('Big Stone Gap is a film directed by Adriana Trigiani.')];
        const hops = selectHopEntities('Big Stone Gap', seeds, context, extra, rels, 1);
        expect(hops[0].entity.id).toBe('person');
    });

    it('seeds the hop from first-pass passages when the question names no entity', () => {
        const context = [normalizeText('Adriana Trigiani wrote and directed it.')];
        const hops = selectHopEntities('Where does she live?', [], context, entities, relations, 2);
        expect(hops.map((h) => h.entity.id)).toContain('city');
    });

    it('formats the relations around the linked entities as facts', () => {
        const facts = relationFacts([{ entity: entities[0], score: 1 }], relations, new Map(entities.map((e) => [e.id, e])));
        expect(facts).toEqual(['Big Stone Gap — directed by → Adriana Trigiani']);
    });
});

describe('citedPassageIndices', () => {
    it('reads [n], [n, m] and [n][m] markers and ignores out-of-range numbers', () => {
        expect(citedPassageIndices('A [1]. B [2, 3]. C [4][9].', 5)).toEqual([1, 2, 3, 4]);
        expect(citedPassageIndices('No markers here.', 5)).toEqual([]);
    });
});
