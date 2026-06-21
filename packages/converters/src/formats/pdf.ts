/**
 * Извлечение перетекаемого текста из PDF через pdf.js.
 * НЕ регистрируется как авто-конвертер (PDF открывается нативно). Вызывается
 * явным действием пользователя «Сделать текстовой»: PDF с текстовым слоем →
 * перетекаемый EPUB со всеми настройками шрифта. Скан без текста → нужен OCR.
 */
import { loadPdfjs, pdfDocOptions, type PdfTextItem, type PdfPageProxy } from '../pdfjs-loader';
import { buildEpub, escapeXml } from '../epub/build';
import { ocrImage, type OcrProgress } from '../ocr/tesseract';
import type { NormalizedDoc, Chapter } from '../types';

export type PdfProgress = (page: number, total: number) => void;

/** Слить текстовые элементы страницы в строки по признаку конца строки. */
function itemsToLines(items: PdfTextItem[]): string[] {
  const lines: string[] = [];
  let line = '';
  for (const it of items) {
    line += it.str;
    if (it.hasEOL) {
      lines.push(line);
      line = '';
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Сгруппировать строки в абзацы: разрыв на пустой строке или конце предложения. */
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

/** Преобразовать PDF в единую модель документа (по главе на страницу). */
export async function convertPdf(
  file: File,
  onProgress?: PdfProgress,
): Promise<NormalizedDoc> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument(pdfDocOptions(data)).promise;

  let title: string | undefined;
  try {
    const md = await doc.getMetadata();
    const t = md.info?.Title;
    if (typeof t === 'string' && t.trim()) title = t.trim();
  } catch {
    /* нет метаданных — ок */
  }

  const chapters: Chapter[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const paragraphs = linesToParagraphs(itemsToLines(items));
    const html = paragraphs.map((t) => `<p>${escapeXml(t)}</p>`).join('\n');
    chapters.push({ id: `page${p}`, title: `Страница ${p}`, html });
    page.cleanup?.();
    onProgress?.(p, doc.numPages);
  }
  return { metadata: { title, language: 'ru' }, chapters };
}

/** Признак, что в PDF нет текстового слоя (скан) — нужен OCR. */
export class NoTextLayerError extends Error {
  constructor() {
    super('В PDF нет текстового слоя (вероятно, скан). Нужно распознавание текста (OCR).');
    this.name = 'NoTextLayerError';
  }
}

/**
 * Сконвертировать PDF в EPUB-файл. Если текстового слоя нет (скан) — бросает
 * NoTextLayerError; вызывающий код может предложить распознавание (pdfOcrToEpubFile).
 */
export async function pdfToEpubFile(
  file: File,
  onProgress?: PdfProgress,
): Promise<File> {
  const doc = await convertPdf(file, onProgress);
  const hasText = doc.chapters.some((c) => c.html.trim().length > 0);
  if (!hasText) throw new NoTextLayerError();
  const blob = await buildEpub(doc);
  const name = `${file.name.replace(/\.pdf$/i, '')} (текст).epub`;
  return new File([blob], name, { type: 'application/epub+zip' });
}

/** Отрисовать страницу PDF в canvas (для OCR). scale↑ — выше качество распознавания. */
async function renderPageToCanvas(page: PdfPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D-контекст недоступен');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export interface OcrPdfProgress {
  page: number;
  total: number;
  /** Статус текущей страницы и прогресс 0..1. */
  status?: string;
  pageProgress?: number;
}

/**
 * Распознать PDF-скан через OCR и собрать перетекаемый EPUB.
 * Обрабатываем по странице (контроль памяти): рендер → OCR → освобождение canvas.
 */
export async function pdfOcrToEpubFile(
  file: File,
  onProgress?: (p: OcrPdfProgress) => void,
): Promise<File> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument(pdfDocOptions(data)).promise;

  const chapters: Chapter[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const canvas = await renderPageToCanvas(page, 2);
    const onOcr: OcrProgress = (status, progress) =>
      onProgress?.({ page: p, total: doc.numPages, status, pageProgress: progress });
    const text = await ocrImage(canvas, onOcr);
    canvas.width = 0;
    canvas.height = 0;
    const paragraphs = linesToParagraphs(text.split('\n'));
    const html = paragraphs.map((t) => `<p>${escapeXml(t)}</p>`).join('\n');
    chapters.push({ id: `page${p}`, title: `Страница ${p}`, html });
    page.cleanup?.();
    onProgress?.({ page: p, total: doc.numPages });
  }

  const model: NormalizedDoc = { metadata: { language: 'ru' }, chapters };
  const blob = await buildEpub(model);
  const name = `${file.name.replace(/\.pdf$/i, '')} (OCR).epub`;
  return new File([blob], name, { type: 'application/epub+zip' });
}
