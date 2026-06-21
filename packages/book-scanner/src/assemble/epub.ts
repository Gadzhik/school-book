/**
 * Stage B: сборка перетекаемого EPUB из сфотографированных страниц через OCR.
 * Каждая страница распознаётся (rus+eng), текст становится главой. Результат —
 * настоящая текстовая книга: работают TTS, размер шрифта, словарь, «Мои слова».
 *
 * Обрабатываем по странице (контроль памяти): читаем из OPFS → OCR → освобождаем.
 */
import { ocrImage, buildEpub, escapeXml } from '@reader/converters';
import { cleanupOcrText } from '@reader/core';
import type { ScanSession } from '../session';
import type { AssembleProgress } from './cbz';

/** Опции сборки EPUB из фото. */
export interface OcrEpubOptions {
  /** LLM-постобработка распознанного текста (исправление OCR + абзацы). */
  cleanup?: boolean;
}

function textToParagraphs(text: string): string {
  return text
    .split(/\n{2,}|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeXml(p)}</p>`)
    .join('\n');
}

/** Собрать EPUB из сессии, распознавая каждую страницу. */
export async function buildOcrEpub(
  session: ScanSession,
  onProgress?: AssembleProgress,
  opts: OcrEpubOptions = {},
): Promise<Blob> {
  const total = session.pages.length;
  if (total === 0) throw new Error('Нет страниц для сборки');

  const chapters = [];
  for (let i = 0; i < total; i++) {
    const page = session.pages[i];
    const blob = await session.getPageBlob(page);
    let text = await ocrImage(blob);
    // LLM-постобработка распознанного текста (graceful: при сбое — исходный OCR).
    if (opts.cleanup) text = await cleanupOcrText(text);
    chapters.push({
      id: `page${i + 1}`,
      title: `Страница ${i + 1}`,
      html: textToParagraphs(text),
    });
    onProgress?.(i + 1, total);
  }

  return buildEpub({ metadata: { language: 'ru' }, chapters });
}
