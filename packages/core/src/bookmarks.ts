/**
 * Закладки в книгах (ТЗ Часть 6, п.6.3). Локально (IndexedDB), синхронизируются
 * с сервером по last-write-wins с тумбстоунами (как «Мои слова», Фаза 5).
 * Привязаны к позиции (locator) внутри книги.
 */
import { getDB } from './storage/db';
import type { Bookmark, BookmarkSyncDelta } from './types';

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface AddBookmarkInput {
  bookId: string;
  locator: string;
  label?: string;
  excerpt?: string;
  fraction?: number;
}

/**
 * Добавить закладку. Если на этой же позиции (bookId+locator) уже есть живая
 * закладка — вернуть её (не дублируем). Удалённую на той же позиции — возрождаем.
 */
export async function addBookmark(input: AddBookmarkInput): Promise<Bookmark> {
  const db = await getDB();
  const now = Date.now();
  const existing = (await db.getAllFromIndex('bookmarks', 'by-book', input.bookId)).find(
    (b) => b.locator === input.locator,
  );
  if (existing) {
    if (!existing.deleted && (existing.label ?? '') === (input.label ?? '')) return existing;
    const updated: Bookmark = {
      ...existing,
      deleted: false,
      label: input.label ?? existing.label,
      excerpt: input.excerpt ?? existing.excerpt,
      fraction: input.fraction ?? existing.fraction,
      updatedAt: now,
    };
    await db.put('bookmarks', updated);
    return updated;
  }
  const entry: Bookmark = {
    id: uid(),
    bookId: input.bookId,
    locator: input.locator,
    label: input.label,
    excerpt: input.excerpt,
    fraction: input.fraction,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('bookmarks', entry);
  return entry;
}

/** Закладки книги (без удалённых), по порядку в книге (по fraction, затем времени). */
export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('bookmarks', 'by-book', bookId);
  return all
    .filter((b) => !b.deleted)
    .sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0) || a.createdAt - b.createdAt);
}

/** Сколько живых закладок в книге. */
export async function countBookmarks(bookId: string): Promise<number> {
  return (await listBookmarks(bookId)).length;
}

/** Изменить подпись закладки. */
export async function renameBookmark(id: string, label: string): Promise<void> {
  const db = await getDB();
  const b = await db.get('bookmarks', id);
  if (!b) return;
  await db.put('bookmarks', { ...b, label, updatedAt: Date.now() });
}

/** Удалить закладку (мягко, тумбстоун — синхронизируется). */
export async function removeBookmark(id: string): Promise<void> {
  const db = await getDB();
  const b = await db.get('bookmarks', id);
  if (!b) return;
  await db.put('bookmarks', { ...b, deleted: true, updatedAt: Date.now() });
}

// --- Синхронизация с сервером (Часть 6, LWW по updatedAt) ---

/** Локальные изменения закладок после метки since — для отправки на сервер. */
export async function bookmarksChangedSince(since: number): Promise<BookmarkSyncDelta[]> {
  const db = await getDB();
  const all = await db.getAll('bookmarks');
  return all
    .filter((b) => b.updatedAt > since)
    .map((b) => ({
      id: b.id,
      bookId: b.bookId,
      locator: b.locator,
      label: b.label,
      excerpt: b.excerpt,
      fraction: b.fraction,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      deleted: b.deleted ?? false,
    }));
}

/**
 * Применить присланные сервером изменения закладок (LWW по updatedAt, ключ id).
 * Тумбстоун неизвестной закладки не материализуем.
 */
export async function applyBookmarkSync(items: BookmarkSyncDelta[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('bookmarks', 'readwrite');
  for (const it of items) {
    const cur = await tx.store.get(it.id);
    if (cur) {
      if (it.updatedAt < cur.updatedAt) continue; // локальная версия свежее
      await tx.store.put({
        ...cur,
        bookId: it.bookId,
        locator: it.locator,
        label: it.label,
        excerpt: it.excerpt,
        fraction: it.fraction,
        deleted: it.deleted ?? false,
        updatedAt: it.updatedAt,
      });
    } else {
      if (it.deleted) continue;
      await tx.store.put({
        id: it.id,
        bookId: it.bookId,
        locator: it.locator,
        label: it.label,
        excerpt: it.excerpt,
        fraction: it.fraction,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      });
    }
  }
  await tx.done;
}
