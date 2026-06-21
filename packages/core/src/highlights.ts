/**
 * Выделения (highlights) с заметками (ТЗ Часть 6, п.6.3/E3). Локально
 * (IndexedDB), синхронизируются с сервером по LWW с тумбстоунами. Привязаны к
 * диапазону текста через CFI — движок перерисовывает их при открытии книги.
 */
import { getDB } from './storage/db';
import type { Highlight, HighlightSyncDelta } from './types';

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface AddHighlightInput {
  bookId: string;
  cfi: string;
  text: string;
  note?: string;
  color?: string;
  fraction?: number;
}

/** Добавить выделение. Если на этом же CFI уже есть живое — вернуть его. */
export async function addHighlight(input: AddHighlightInput): Promise<Highlight> {
  const db = await getDB();
  const now = Date.now();
  const existing = (await db.getAllFromIndex('highlights', 'by-book', input.bookId)).find(
    (h) => h.cfi === input.cfi && !h.deleted,
  );
  if (existing) return existing;
  const entry: Highlight = {
    id: uid(),
    bookId: input.bookId,
    cfi: input.cfi,
    text: input.text,
    note: input.note,
    color: input.color,
    fraction: input.fraction,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('highlights', entry);
  return entry;
}

/** Выделения книги (без удалённых), по порядку в книге. */
export async function listHighlights(bookId: string): Promise<Highlight[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('highlights', 'by-book', bookId);
  return all
    .filter((h) => !h.deleted)
    .sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0) || a.createdAt - b.createdAt);
}

/** Найти выделение по CFI (для клика по подсветке). */
export async function getHighlightByCfi(bookId: string, cfi: string): Promise<Highlight | undefined> {
  const db = await getDB();
  return (await db.getAllFromIndex('highlights', 'by-book', bookId)).find(
    (h) => h.cfi === cfi && !h.deleted,
  );
}

/** Изменить заметку выделения. */
export async function setHighlightNote(id: string, note: string): Promise<void> {
  const db = await getDB();
  const h = await db.get('highlights', id);
  if (!h) return;
  await db.put('highlights', { ...h, note, updatedAt: Date.now() });
}

/** Удалить выделение (мягко, тумбстоун — синхронизируется). */
export async function removeHighlight(id: string): Promise<void> {
  const db = await getDB();
  const h = await db.get('highlights', id);
  if (!h) return;
  await db.put('highlights', { ...h, deleted: true, updatedAt: Date.now() });
}

// --- Синхронизация с сервером (Часть 6, LWW по updatedAt) ---

/** Локальные изменения выделений после метки since — для отправки на сервер. */
export async function highlightsChangedSince(since: number): Promise<HighlightSyncDelta[]> {
  const db = await getDB();
  const all = await db.getAll('highlights');
  return all
    .filter((h) => h.updatedAt > since)
    .map((h) => ({
      id: h.id,
      bookId: h.bookId,
      cfi: h.cfi,
      text: h.text,
      note: h.note,
      color: h.color,
      fraction: h.fraction,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
      deleted: h.deleted ?? false,
    }));
}

/** Применить присланные сервером изменения выделений (LWW по updatedAt, ключ id). */
export async function applyHighlightSync(items: HighlightSyncDelta[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('highlights', 'readwrite');
  for (const it of items) {
    const cur = await tx.store.get(it.id);
    if (cur) {
      if (it.updatedAt < cur.updatedAt) continue;
      await tx.store.put({
        ...cur,
        bookId: it.bookId,
        cfi: it.cfi,
        text: it.text,
        note: it.note,
        color: it.color,
        fraction: it.fraction,
        deleted: it.deleted ?? false,
        updatedAt: it.updatedAt,
      });
    } else {
      if (it.deleted) continue;
      await tx.store.put({
        id: it.id,
        bookId: it.bookId,
        cfi: it.cfi,
        text: it.text,
        note: it.note,
        color: it.color,
        fraction: it.fraction,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      });
    }
  }
  await tx.done;
}
