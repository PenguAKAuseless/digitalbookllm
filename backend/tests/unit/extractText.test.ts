import JSZip from 'jszip';
import { extractText } from '../../src/ingestion/extractText';

async function buildEpub(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml',
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package><manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="c2" href="text/chapter%202.xhtml" media-type="application/xhtml+xml"/>
        <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="css" href="style.css" media-type="text/css"/>
    </manifest><spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`);
    zip.file('OEBPS/nav.xhtml', '<html><body><nav>Table of contents</nav></body></html>');
    zip.file('OEBPS/text/chapter1.xhtml',
        '<html><head><style>p{}</style></head><body><h1>Chapter 1</h1><p>Caf&#233; &amp; tea&nbsp;time.</p><p>Second<br/>line.</p></body></html>');
    zip.file('OEBPS/text/chapter 2.xhtml', '<html><body><p>Chương hai.</p></body></html>');
    return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extractText — EPUB', () => {
    it('reads chapters in spine order as plain text, skipping the nav document', async () => {
        const result = await extractText(await buildEpub(), 'application/epub+zip', 'book.epub');

        expect(result.fullText).toBe('Chapter 1\n\nCafé & tea time.\n\nSecond\nline.\n\nChương hai.');
        expect(result.fullText).not.toContain('Table of contents');
        expect(result.usedOcr).toBe(false);
        expect(result.pageCount).toBe(1);
    });

    it('is detected by extension when the browser sends a generic MIME type', async () => {
        const result = await extractText(await buildEpub(), 'application/octet-stream', 'book.epub');
        expect(result.fullText).toContain('Chương hai.');
    });
});
