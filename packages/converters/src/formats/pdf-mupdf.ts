/**
 * Альтернативный PDF→текст адаптер на mupdf-wasm (MuPDF.js, Artifex).
 * Взаимозаменяем с pdf.js-адаптером (formats/pdf.ts) — ТЗ ч.3 п.13: адаптеры
 * как плагины. MuPDF часто точнее извлекает текст из сложных PDF. НЕ авто-
 * регистрируется (PDF открывается нативно); вызывается явным действием.
 *
 * ⚠️ Лицензия mupdf — AGPL-3.0-or-later. Для распространения это накладывает
 * обязательства (исходники по сети). Использовать осознанно; pdf.js-адаптер
 * (Apache-2.0) остаётся дефолтным и не затронут.
 *
 * Тяжёлый WASM (~10 МБ) грузим лениво — только при первом вызове.
 */
import { buildEpub, escapeXml } from '../epub/build';
import { NoTextLayerError, type PdfProgress } from './pdf';
import type { NormalizedDoc, Chapter } from '../types';

/** Лениво загрузить mupdf (тяжёлый WASM). */
async function loadMupdf(): Promise<typeof import('mupdf')> {
  return import('mupdf');
}

/** Сгруппировать строки текста в абзацы (разрыв на пустой/конце предложения). */
function linesToParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let cur = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (cur) {
        paragraphs.push(cur);
        cur = '';
      }
      continue;
    }
    cur = cur ? `${cur} ${l}` : l;
    if (/[.!?:»"]$/.test(l)) {
      paragraphs.push(cur);
      cur = '';
    }
  }
  if (cur) paragraphs.push(cur);
  return paragraphs;
}

/** Преобразовать PDF в единую модель документа через mupdf (глава на страницу). */
export async function convertPdfMupdf(
  file: File,
  onProgress?: PdfProgress,
): Promise<NormalizedDoc> {
  const mupdf = await loadMupdf();
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');

  let title: string | undefined;
  try {
    const t = doc.getMetaData('info:Title');
    if (t && t.trim()) title = t.trim();
  } catch {
    /* нет метаданных — ок */
  }

  const chapters: Chapter[] = [];
  try {
    const total = doc.countPages();
    for (let p = 0; p < total; p++) {
      const page = doc.loadPage(p);
      const stext = page.toStructuredText('preserve-whitespace');
      const text = stext.asText();
      stext.destroy();
      page.destroy();

      const paragraphs = linesToParagraphs(text.split('\n'));
      const html = paragraphs.map((t) => `<p>${escapeXml(t)}</p>`).join('\n');
      chapters.push({ id: `page${p + 1}`, title: `Страница ${p + 1}`, html });
      onProgress?.(p + 1, total);
    }
  } finally {
    doc.destroy();
  }

  return { metadata: { title, language: 'ru' }, chapters };
}

/**
 * Сконвертировать PDF в EPUB-файл через mupdf. Если текстового слоя нет (скан) —
 * бросает NoTextLayerError (как pdf.js-адаптер; дальше можно предложить OCR).
 */
export async function pdfMupdfToEpubFile(
  file: File,
  onProgress?: PdfProgress,
): Promise<File> {
  const doc = await convertPdfMupdf(file, onProgress);
  const hasText = doc.chapters.some((c) => c.html.trim().length > 0);
  if (!hasText) throw new NoTextLayerError();
  const blob = await buildEpub(doc);
  const name = `${file.name.replace(/\.pdf$/i, '')} (текст, mupdf).epub`;
  return new File([blob], name, { type: 'application/epub+zip' });
}
