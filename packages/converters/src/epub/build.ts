/**
 * Сборка минимального валидного EPUB 3 из единой модели документа.
 * Без DOM — только строки + fflate, поэтому работает и в воркере, и в node.
 *
 * Структура:
 *   mimetype            (хранится без сжатия, первым — требование OCF)
 *   META-INF/container.xml
 *   OEBPS/content.opf   (метаданные, manifest, spine)
 *   OEBPS/nav.xhtml     (оглавление EPUB 3)
 *   OEBPS/<id>.xhtml    (главы)
 */
import { zip } from 'fflate';
import type { NormalizedDoc } from '../types';

const enc = new TextEncoder();

/** Экранирование для XML/HTML-текста. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function uuid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function chapterXhtml(title: string, body: string, lang: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title></head>
<body>
${body}
</body>
</html>`;
}

function navXhtml(doc: NormalizedDoc, lang: string): string {
  const items = doc.chapters
    .map(
      (c) =>
        `      <li><a href="${c.id}.xhtml">${escapeXml(c.title ?? c.id)}</a></li>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head><meta charset="utf-8"/><title>Оглавление</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Оглавление</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
}

function contentOpf(doc: NormalizedDoc, id: string, lang: string): string {
  const title = doc.metadata.title ?? 'Без названия';
  const author = doc.metadata.author;
  const manifest = doc.chapters
    .map(
      (c) =>
        `    <item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('\n');
  const spine = doc.chapters.map((c) => `    <itemref idref="${c.id}"/>`).join('\n');
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(lang)}</dc:language>
${author ? `    <dc:creator>${escapeXml(author)}</dc:creator>\n` : ''}    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

/** Собрать EPUB-блоб из нормализованного документа. */
export async function buildEpub(doc: NormalizedDoc): Promise<Blob> {
  const lang = doc.metadata.language || 'ru';
  const id = uuid();

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    // mimetype обязан идти первым и без сжатия.
    mimetype: [enc.encode('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': [enc.encode(CONTAINER_XML), { level: 6 }],
    'OEBPS/content.opf': [enc.encode(contentOpf(doc, id, lang)), { level: 6 }],
    'OEBPS/nav.xhtml': [enc.encode(navXhtml(doc, lang)), { level: 6 }],
  };
  for (const c of doc.chapters) {
    files[`OEBPS/${c.id}.xhtml`] = [
      enc.encode(chapterXhtml(c.title ?? '', c.html, lang)),
      { level: 6 },
    ];
  }

  const data = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, (err, out) => (err ? reject(err) : resolve(out)));
  });
  return new Blob([data as BlobPart], { type: 'application/epub+zip' });
}
