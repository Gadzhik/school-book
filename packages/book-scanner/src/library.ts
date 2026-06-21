/**
 * Сохранение собранной книги в общую библиотеку (packages/core).
 * Переиспользуем addBook: формат определится по сигнатуре, файл ляжет в OPFS,
 * метаданные — в IndexedDB. Сверху проставляем название/автора/обложку.
 */
import { addBook, updateBook, type BookMeta } from '@reader/core';
import { assembleBook, type AssembleProgress, type AssembleOptions } from './assemble';
import type { OutputFormat, ScanBookMeta } from './types';
import type { ScanSession } from './session';

function sanitizeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  return clean || 'Книга';
}

/**
 * Собрать книгу из сессии и добавить её в библиотеку.
 * Возвращает метаданные созданной книги.
 */
export async function saveScannedBook(
  session: ScanSession,
  format: OutputFormat,
  meta: ScanBookMeta,
  onProgress?: AssembleProgress,
  opts: AssembleOptions = {},
): Promise<BookMeta> {
  const { blob, ext } = await assembleBook(session, format, onProgress, opts);

  const fileName = `${sanitizeFileName(meta.title)}.${ext}`;
  const file = new File([blob], fileName, { type: blob.type });
  const book = await addBook(file);

  // Обложка — превью выбранной (или первой) страницы.
  const coverPage =
    session.pages.find((p) => p.id === meta.coverPageId) ?? session.pages[0];

  await updateBook(book.id, {
    title: meta.title,
    author: meta.author,
    cover: coverPage?.thumb,
  });

  return { ...book, title: meta.title, author: meta.author, cover: coverPage?.thumb };
}
