/**
 * Библиотека книг: добавление, перечисление, чтение, удаление, прогресс.
 * Метаданные — в IndexedDB (store 'books'), бинарник — в OPFS,
 * с откатом на IndexedDB (store 'blobs'), если OPFS недоступен.
 */
import { getDB } from './db';
import {
  isOpfsSupported,
  saveBlobToOpfs,
  readBlobFromOpfs,
  deleteBlobFromOpfs,
} from './opfs';
import { detectFormat } from '../format';
import type { BookFormat, BookMeta, FacetFilter, Facet } from '../types';

/** Расширение для хранения по формату. */
function extFor(format: BookFormat, fileName: string): string {
  if (format === 'fb2.zip') return 'fb2.zip';
  if (format !== 'unknown') return format;
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : 'bin';
}

/** Сгенерировать id. */
function newId(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/** Заголовок по умолчанию из имени файла (без расширения). */
function titleFromFileName(name: string): string {
  return name.replace(/\.(fb2\.zip|[a-z0-9]+)$/i, '').trim() || name;
}

/**
 * Добавить файл в библиотеку.
 * Формат определяется по сигнатуре. Метаданные из содержимого книги
 * (точный заголовок/автор/обложка) дополняются позже движком чтения.
 */
export async function addBook(file: File): Promise<BookMeta> {
  const format = await detectFormat(file);
  const id = newId();
  const ext = extFor(format, file.name);

  let backend: 'opfs' | 'idb' = 'idb';
  let path = id;
  if (isOpfsSupported()) {
    try {
      path = await saveBlobToOpfs(id, ext, file);
      backend = 'opfs';
    } catch {
      backend = 'idb';
    }
  }

  const db = await getDB();
  if (backend === 'idb') {
    await db.put('blobs', file, id);
  }

  const meta: BookMeta = {
    id,
    title: titleFromFileName(file.name),
    format,
    fileName: file.name,
    size: file.size,
    addedAt: Date.now(),
    progress: 0,
  };
  // Место хранения кодируем в locator-независимом поле через meta.id + backend.
  // Backend сохраняем в отдельной служебной записи внутри meta (расширяемо).
  (meta as BookMeta & { _backend: string; _path: string })._backend = backend;
  (meta as BookMeta & { _backend: string; _path: string })._path = path;

  await db.put('books', meta);
  return meta;
}

/** Список книг, по убыванию даты последнего открытия / добавления. */
export async function listBooks(): Promise<BookMeta[]> {
  const db = await getDB();
  const all = await db.getAll('books');
  return all.sort(
    (a, b) =>
      (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt),
  );
}

/** Получить метаданные книги. */
export async function getBook(id: string): Promise<BookMeta | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

/** Получить файл книги для открытия в движке. */
export async function getBookFile(id: string): Promise<File> {
  const db = await getDB();
  const meta = await db.get('books', id);
  if (!meta) throw new Error(`Книга не найдена: ${id}`);
  const m = meta as BookMeta & { _backend?: string; _path?: string };
  if (m._backend === 'opfs' && m._path) {
    return readBlobFromOpfs(m._path);
  }
  const blob = await db.get('blobs', id);
  if (!blob) throw new Error(`Файл книги не найден: ${id}`);
  return new File([blob], meta.fileName);
}

/** Обновить метаданные книги (частично). */
export async function updateBook(id: string, patch: Partial<BookMeta>): Promise<void> {
  const db = await getDB();
  const meta = await db.get('books', id);
  if (!meta) return;
  await db.put('books', { ...meta, ...patch });
}

/** Сохранить прогресс и позицию чтения. */
export async function saveProgress(
  id: string,
  progress: number,
  locator?: string,
): Promise<void> {
  await updateBook(id, {
    progress,
    locator,
    lastOpenedAt: Date.now(),
  });
}

// --- Тегирование и классификация (ТЗ Часть 5) ---

/** Поля тегов книги. */
export type BookTagFields = Pick<BookMeta, Facet>;

/**
 * Полностью задать наборы тегов книги (замена значений по измерениям).
 * Передавайте только те измерения, что нужно изменить.
 */
export async function setBookTags(
  id: string,
  patch: Partial<BookTagFields>,
): Promise<void> {
  await updateBook(id, patch);
}

/**
 * Переключить одно значение тега в измерении (добавить/убрать).
 * Удобно для UI-чекбоксов.
 */
export async function toggleBookTag(
  id: string,
  facet: Facet,
  value: string,
): Promise<void> {
  const db = await getDB();
  const meta = await db.get('books', id);
  if (!meta) return;
  const cur = new Set(meta[facet] ?? []);
  if (cur.has(value)) cur.delete(value);
  else cur.add(value);
  await db.put('books', { ...meta, [facet]: [...cur] });
}

/** Проверка соответствия книги фасетному фильтру (И между, ИЛИ внутри). */
export function matchesFacets(book: BookMeta, filter: FacetFilter): boolean {
  const dims: Facet[] = ['categories', 'classes', 'subjects', 'tags'];
  for (const dim of dims) {
    const wanted = filter[dim];
    if (!wanted || wanted.length === 0) continue; // нет ограничения
    const have = new Set(book[dim] ?? []);
    // ИЛИ внутри измерения: хватает любого совпадения.
    if (!wanted.some((v) => have.has(v))) return false;
  }
  if (filter.query?.trim()) {
    const q = filter.query.trim().toLowerCase();
    const hay = `${book.title} ${book.author ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Книги, удовлетворяющие фасетному фильтру (отсортированы как listBooks). */
export async function getBooksByFacets(filter: FacetFilter): Promise<BookMeta[]> {
  const all = await listBooks();
  return all.filter((b) => matchesFacets(b, filter));
}

/** Удалить книгу вместе с файлом. */
export async function deleteBook(id: string): Promise<void> {
  const db = await getDB();
  const meta = await db.get('books', id);
  if (!meta) return;
  const m = meta as BookMeta & { _backend?: string; _path?: string };
  if (m._backend === 'opfs' && m._path) {
    await deleteBlobFromOpfs(m._path);
  } else {
    await db.delete('blobs', id);
  }
  await db.delete('books', id);
}
