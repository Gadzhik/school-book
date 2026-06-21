/**
 * OCR через Tesseract.js (Apache-2.0). Распознавание русского+английского.
 * Ассеты (worker, core-wasm, языковые данные) отдаются локально из /tesseract —
 * полностью офлайн (ТЗ): worker/core копируются из node_modules при сборке,
 * языковые данные лежат в public/tesseract/lang.
 *
 * Тяжёлый движок грузится лениво — только при первом распознавании.
 */
import { createWorker, type Worker } from 'tesseract.js';

export type OcrProgress = (status: string, progress: number) => void;

let currentProgress: OcrProgress | undefined;
let workerPromise: Promise<Worker> | null = null;

/** Доступен ли OCR (наличие worker-ассета проверяется при первом вызове). */
export function isOcrConfigured(): boolean {
  return typeof Worker !== 'undefined' || typeof window !== 'undefined';
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('rus+eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract',
      langPath: '/tesseract/lang',
      logger: (m: { status: string; progress: number }) =>
        currentProgress?.(m.status, m.progress),
    });
  }
  return workerPromise;
}

/** Распознать изображение (canvas/Blob/ImageBitmap/URL) → текст. */
export async function ocrImage(
  image: Parameters<Worker['recognize']>[0],
  onProgress?: OcrProgress,
): Promise<string> {
  currentProgress = onProgress;
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return data.text;
}

/** Слово с координатами рамки (пиксели изображения, начало — левый верх). */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Распознать изображение, вернув слова с координатами рамок — для построения
 * невидимого текстового слоя searchable PDF (ТЗ Фаза 2).
 */
export async function ocrWords(
  image: Parameters<Worker['recognize']>[0],
  onProgress?: OcrProgress,
): Promise<OcrWord[]> {
  currentProgress = onProgress;
  const worker = await getWorker();
  // Блоки нужны, чтобы получить иерархию до уровня слов с bbox.
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const words: OcrWord[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const block of (data as any).blocks ?? []) {
    for (const par of block.paragraphs ?? []) {
      for (const line of par.lines ?? []) {
        for (const w of line.words ?? []) {
          const t = String(w.text ?? '').trim();
          if (!t || !w.bbox) continue;
          words.push({ text: t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
        }
      }
    }
  }
  return words;
}

/** Завершить OCR-воркер и освободить память. */
export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
