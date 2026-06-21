/**
 * Низкоуровневый доступ к IndexedDB через библиотеку idb.
 * Хранилища:
 *   - books      : метаданные книг (BookMeta), ключ — id
 *   - blobs      : бинарное содержимое книг (fallback, если OPFS недоступен)
 *   - settings   : настройки приложения (одна запись с ключом 'reader')
 *   - categories : словарь категорий (тип материала)  [v2]
 *   - subjects   : словарь предметов (ФГОС)            [v2]
 *   - classes    : словарь учебных классов 1–11        [v2]
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BookMeta,
  ReaderSettings,
  CategoryEntry,
  SubjectEntry,
  ClassEntry,
  SavedWord,
  Bookmark,
  Highlight,
} from '../types';

const DB_NAME = 'reader-db';
// v2: словари классификации (Часть 5). v3: «Мои слова» + карточки (Фаза 3).
// v4: поле updatedAt у слов для синхронизации с сервером (Фаза 5).
// v5: закладки в книгах (Часть 6, п.6.3). v6: выделения/заметки (Часть 6, E3).
const DB_VERSION = 6;

interface ReaderDB extends DBSchema {
  books: {
    key: string;
    value: BookMeta;
    indexes: { 'by-lastOpened': number; 'by-added': number };
  };
  blobs: {
    key: string;
    value: Blob;
  };
  settings: {
    key: string;
    value: ReaderSettings;
  };
  categories: {
    key: string;
    value: CategoryEntry;
  };
  subjects: {
    key: string;
    value: SubjectEntry;
  };
  classes: {
    key: string;
    value: ClassEntry;
  };
  words: {
    key: string;
    value: SavedWord;
    indexes: { 'by-due': number };
  };
  bookmarks: {
    key: string;
    value: Bookmark;
    indexes: { 'by-book': string };
  };
  highlights: {
    key: string;
    value: Highlight;
    indexes: { 'by-book': string };
  };
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null;

/** Получить (лениво открыть) соединение с базой. */
export function getDB(): Promise<IDBPDatabase<ReaderDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>(DB_NAME, DB_VERSION, {
      // Аддитивные миграции: старые стора не трогаем, добавляем новые.
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('by-lastOpened', 'lastOpenedAt');
          books.createIndex('by-added', 'addedAt');
          db.createObjectStore('blobs');
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('categories', { keyPath: 'id' });
          db.createObjectStore('subjects', { keyPath: 'id' });
          db.createObjectStore('classes', { keyPath: 'id' });
        }
        if (oldVersion < 3) {
          const words = db.createObjectStore('words', { keyPath: 'id' });
          words.createIndex('by-due', 'due');
        }
        if (oldVersion >= 3 && oldVersion < 4) {
          // Бэкофилл updatedAt у уже сохранённых слов (= addedAt).
          let cur = await tx.objectStore('words').openCursor();
          while (cur) {
            if (cur.value.updatedAt === undefined) {
              await cur.update({ ...cur.value, updatedAt: cur.value.addedAt });
            }
            cur = await cur.continue();
          }
        }
        if (oldVersion < 5) {
          const bm = db.createObjectStore('bookmarks', { keyPath: 'id' });
          bm.createIndex('by-book', 'bookId');
        }
        if (oldVersion < 6) {
          const hl = db.createObjectStore('highlights', { keyPath: 'id' });
          hl.createIndex('by-book', 'bookId');
        }
      },
    });
  }
  return dbPromise;
}

export type { ReaderDB };
