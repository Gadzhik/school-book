/**
 * Сборка CBZ — это ZIP с изображениями страниц по порядку.
 * foliate-js открывает CBZ нативно (comic-book.js), так что собранная книга
 * сразу читается в обычной читалке. Текстового слоя нет (Stage A без OCR).
 *
 * Изображения уже сжаты в JPEG, поэтому пакуем без компрессии (level 0) —
 * быстро и без лишней нагрузки на слабые устройства.
 */
import { zip } from 'fflate';
import type { ScanSession } from '../session';

/** Имя файла страницы с ведущими нулями для правильной сортировки. */
function pageName(index: number, total: number): string {
  const width = Math.max(3, String(total).length);
  return `${String(index + 1).padStart(width, '0')}.jpg`;
}

export interface AssembleProgress {
  (done: number, total: number): void;
}

/** Собрать CBZ из страниц сессии. */
export async function buildCbz(
  session: ScanSession,
  onProgress?: AssembleProgress,
): Promise<Blob> {
  const total = session.pages.length;
  if (total === 0) throw new Error('Нет страниц для сборки');

  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (let i = 0; i < total; i++) {
    const page = session.pages[i];
    const blob = await session.getPageBlob(page);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    files[pageName(i, total)] = [bytes, { level: 0 }];
    onProgress?.(i + 1, total);
  }

  const data = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)));
  });

  // data — Uint8Array; приводим к BlobPart (расхождение типов ArrayBufferLike в TS 5.7).
  return new Blob([data as BlobPart], { type: 'application/vnd.comicbook+zip' });
}
