/**
 * Оркестрация импорта файла в библиотеку.
 * - Форматы, которые читалка открывает нативно (foliate/pdf.js) — добавляем как есть.
 * - Прочие (DOCX/HTML/...) — конвертируем в EPUB через зарегистрированный адаптер.
 * - Если конвертера нет — всё равно пробуем добавить (foliate может справиться).
 */
import {
  addBook,
  updateBook,
  detectFormat,
  suggestTags,
  type AutoTags,
  type BookFormat,
  type BookMeta,
} from '@reader/core';
import { findConverter } from './registry';
import { buildEpub } from './epub/build';
import { extractBookMetadata, type BookMetadata } from './metadata';
import { pandocToEpubFile, pandocSupports } from './formats/pandoc';

/** Форматы, открываемые читалкой напрямую (без конвертации). */
const NATIVE: BookFormat[] = [
  'epub',
  'fb2',
  'fb2.zip',
  'mobi',
  'azw3',
  'pdf',
  'cbz',
  'cbr',
];

/** Заменить расширение имени файла. */
function withExt(name: string, ext: string): string {
  const base = name.replace(/\.[^./\\]+$/, '');
  return `${base}.${ext}`;
}

export interface ImportResult {
  book: BookMeta;
  /** Была ли выполнена конвертация в EPUB. */
  converted: boolean;
  /**
   * Какие теги авторазметка реально проставила (ТЗ 5.4 — предложение).
   * Пустые массивы, если ничего не угадалось. UI показывает их на ревью,
   * чтобы пользователь подтвердил/поправил — финальное слово за человеком.
   */
  applied: AutoTags;
}

/**
 * Импортировать файл: при необходимости сконвертировать в EPUB, затем
 * добавить в библиотеку. Возвращает метаданные книги и флаг конвертации.
 */
/** Похоже ли название на «сырой» дефолт из имени файла (а не настоящий заголовок). */
function looksLikeFileName(title: string, fileName: string): boolean {
  const base = fileName.replace(/\.(fb2\.zip|[a-z0-9]+)$/i, '').trim();
  return title.trim() === base;
}

/**
 * Авторазметка (ТЗ 5.4): по имени файла, заголовку и метаданным книги
 * (источник #1 — `dc:subject`/жанры FB2/серия) предлагаем класс/предмет/
 * категорию и применяем, не перетирая уже выставленные пользователем теги.
 * Заодно уточняем заголовок/автора/язык, если из файла они точнее.
 */
async function applyAutoTags(
  book: BookMeta,
  fileName: string,
  meta?: BookMetadata,
): Promise<AutoTags> {
  const title = meta?.title ?? book.title;
  const tags = suggestTags({
    fileName,
    title,
    author: meta?.author,
    keywords: meta?.keywords,
    fb2Genres: meta?.fb2Genres,
    series: meta?.series,
  });
  const patch: Partial<BookMeta> = {};
  // Уточняем карточку из метаданных книги (заголовок из файла часто «сырой»).
  if (meta?.title && looksLikeFileName(book.title, book.fileName)) patch.title = meta.title;
  if (meta?.author && !book.author) patch.author = meta.author;
  if (meta?.language && !book.language) patch.language = meta.language;
  // Теги — только в пустые измерения (предложение, не навязывание).
  const applied: AutoTags = { classes: [], subjects: [], categories: [] };
  if (tags.classes.length && !(book.classes?.length)) patch.classes = applied.classes = tags.classes;
  if (tags.subjects.length && !(book.subjects?.length)) patch.subjects = applied.subjects = tags.subjects;
  if (tags.categories.length && !(book.categories?.length)) patch.categories = applied.categories = tags.categories;
  if (Object.keys(patch).length) await updateBook(book.id, patch);
  return applied;
}

export interface ImportOptions {
  /**
   * Конвертировать документы (DOCX/RTF/ODT/HTML/MD) через pandoc-wasm вместо
   * встроенных адаптеров (ТЗ ч.3 п.13). Тяжёлый WASM — по выбору пользователя.
   */
  preferPandoc?: boolean;
}

export async function importFile(file: File, opts: ImportOptions = {}): Promise<ImportResult> {
  const format = await detectFormat(file);

  if (!NATIVE.includes(format)) {
    // Альтернативный путь: pandoc-wasm для документов (если пользователь включил).
    if (opts.preferPandoc && pandocSupports(format)) {
      try {
        const epubFile = await pandocToEpubFile(file, format);
        const book = await addBook(epubFile);
        const applied = await applyAutoTags(book, file.name, {
          title: withExt(file.name, '').slice(0, -1),
          keywords: [],
          fb2Genres: [],
        });
        return { book, converted: true, applied };
      } catch (err) {
        // pandoc не справился — откатываемся на встроенный конвертер ниже.
        console.warn('pandoc-конвертация не удалась, fallback на встроенный адаптер', err);
      }
    }

    const conv = findConverter(format);
    if (conv) {
      const doc = await conv.convert(file);
      if (!doc.metadata.title) doc.metadata.title = withExt(file.name, '').slice(0, -1);
      const epub = await buildEpub(doc);
      const epubFile = new File([epub], withExt(file.name, 'epub'), {
        type: 'application/epub+zip',
      });
      const book = await addBook(epubFile);
      // Метаданные берём из нормализованного документа (subject'ов нет).
      const applied = await applyAutoTags(book, file.name, {
        title: doc.metadata.title,
        author: doc.metadata.author,
        language: doc.metadata.language,
        keywords: [],
        fb2Genres: [],
      });
      return { book, converted: true, applied };
    }
  }

  // Нативный формат или нет подходящего конвертера — добавляем как есть.
  const book = await addBook(file);
  const meta = await extractBookMetadata(file, format);
  const applied = await applyAutoTags(book, file.name, meta);
  return { book, converted: false, applied };
}
