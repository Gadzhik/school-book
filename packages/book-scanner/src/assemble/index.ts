/**
 * Диспетчер сборки книги по выбранному формату.
 * Stage A: только CBZ (изображения без OCR).
 * Stage B (после OCR Фазы 2): добавить 'pdf' (searchable) и 'epub' (reflowable).
 */
import { buildCbz, type AssembleProgress } from './cbz';
import { buildOcrEpub } from './epub';
import { buildSearchablePdf } from './pdf-searchable';
import type { ScanSession } from '../session';
import type { OutputFormat } from '../types';

export interface AssembleResult {
  blob: Blob;
  /** Расширение файла для сохранения. */
  ext: string;
}

/** Опции сборки книги из фото. */
export interface AssembleOptions {
  /** LLM-постобработка OCR-текста (только формат EPUB). */
  cleanup?: boolean;
}

/** Собрать книгу из сессии в указанном формате. */
export async function assembleBook(
  session: ScanSession,
  format: OutputFormat,
  onProgress?: AssembleProgress,
  opts: AssembleOptions = {},
): Promise<AssembleResult> {
  switch (format) {
    case 'cbz': {
      const blob = await buildCbz(session, onProgress);
      return { blob, ext: 'cbz' };
    }
    case 'epub': {
      // Stage B: распознаём страницы и собираем перетекаемый EPUB.
      const blob = await buildOcrEpub(session, onProgress, { cleanup: opts.cleanup });
      return { blob, ext: 'epub' };
    }
    case 'pdf': {
      // Stage B: страница-картинка + невидимый OCR-слой (выбор/поиск текста).
      const blob = await buildSearchablePdf(session, onProgress);
      return { blob, ext: 'pdf' };
    }
    default:
      throw new Error(`Неизвестный формат: ${format as string}`);
  }
}

export { buildCbz } from './cbz';
export { buildSearchablePdf } from './pdf-searchable';
export { buildOcrEpub } from './epub';
export type { OcrEpubOptions } from './epub';
export type { AssembleProgress } from './cbz';
