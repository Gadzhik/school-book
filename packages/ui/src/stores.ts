/**
 * Сторы состояния приложения (Svelte stores).
 * Состояние держим здесь, чтобы компоненты оставались переиспользуемыми.
 */
import { writable, get } from 'svelte/store';
import {
  listBooks,
  deleteBook as deleteBookCore,
  updateBook,
  loadSettings,
  saveSettings,
  setLlmConfig,
  DEFAULT_SETTINGS,
  type BookMeta,
  type ReaderSettings,
} from '@reader/core';
import type { ImportResult } from '@reader/converters';
// Импорт идёт через конвертеры: не-нативные форматы (DOCX/HTML/...) при
// добавлении конвертируются в EPUB, нативные — добавляются как есть.
import { importFile } from '@reader/converters';

/** Текущий экран приложения. */
export type ViewState =
  | { name: 'library' }
  | { name: 'reader'; bookId: string }
  | { name: 'scanner' }
  | { name: 'words' }
  | { name: 'server' }
  | { name: 'report' };

const VIEW_KEY = 'reader:view';

/** Восстановить последний вид из localStorage (только открытую книгу). */
function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) {
      const v = JSON.parse(raw) as ViewState;
      if (v?.name === 'reader' && v.bookId) return v;
    }
  } catch {
    /* нет доступа к localStorage — ок */
  }
  return { name: 'library' };
}

export const view = writable<ViewState>(loadView());

// Сохраняем активную книгу, чтобы после перезагрузки остаться в ней.
// Библиотека/сканер не персистятся (сессия сканера живёт только в памяти).
view.subscribe((v) => {
  try {
    if (v.name === 'reader') localStorage.setItem(VIEW_KEY, JSON.stringify(v));
    else localStorage.removeItem(VIEW_KEY);
  } catch {
    /* ок */
  }
});

/** Список книг библиотеки. */
export const books = writable<BookMeta[]>([]);

/** Обновить список книг из хранилища. */
export async function refreshLibrary(): Promise<void> {
  books.set(await listBooks());
}

/**
 * Запись ревью авторазметки (ТЗ 5.4): книга и теги, что движок предложил
 * и проставил при импорте. UI показывает их для подтверждения/правки.
 */
export interface ImportReviewItem {
  bookId: string;
  title: string;
  classes: string[];
  subjects: string[];
  categories: string[];
}

/** Книги последнего импорта с авторазмеченными тегами (для ревью-баннера). */
export const importReview = writable<ImportReviewItem[]>([]);

/** Убрать книгу из ревью (пользователь подтвердил/закрыл). */
export function dismissReview(bookId: string): void {
  importReview.update((items) => items.filter((i) => i.bookId !== bookId));
}

/** Очистить весь ревью-баннер. */
export function clearReview(): void {
  importReview.set([]);
}

/** Накопить запись авторазметки в ревью, если что-то проставлено. */
function collectReview(res: ImportResult, into: ImportReviewItem[]): void {
  const { book, applied } = res;
  if (applied.classes.length || applied.subjects.length || applied.categories.length) {
    into.push({
      bookId: book.id,
      title: book.title,
      classes: applied.classes,
      subjects: applied.subjects,
      categories: applied.categories,
    });
  }
}

/** Добавить файлы в библиотеку и обновить список. */
export async function addFiles(files: FileList | File[]): Promise<void> {
  const review: ImportReviewItem[] = [];
  const preferPandoc = get(settings).pandocDocs;
  for (const file of Array.from(files)) {
    try {
      collectReview(await importFile(file, { preferPandoc }), review);
    } catch (err) {
      console.error('Не удалось добавить файл', file.name, err);
    }
  }
  await refreshLibrary();
  if (review.length) importReview.update((cur) => [...review, ...cur]);
}

/**
 * Импортировать книгу, скачанную с сервера (Фаза 5): как обычный импорт,
 * плюс сохраняем serverId для синхронизации прогресса между устройствами.
 */
export async function importServerBook(file: File, serverId: string): Promise<void> {
  const review: ImportReviewItem[] = [];
  try {
    const res = await importFile(file);
    await updateBook(res.book.id, { serverId });
    collectReview(res, review);
  } catch (err) {
    console.error('Не удалось импортировать книгу с сервера', file.name, err);
    throw err;
  }
  await refreshLibrary();
  if (review.length) importReview.update((cur) => [...review, ...cur]);
}

/** Удалить книгу. */
export async function removeBook(id: string): Promise<void> {
  await deleteBookCore(id);
  await refreshLibrary();
}

/** Открыта ли книга с фиксированной вёрсткой (PDF) — для адаптации настроек. */
export const readerIsFixedLayout = writable(false);

/** Настройки читалки. */
export const settings = writable<ReaderSettings>(DEFAULT_SETTINGS);

/** Передать конфигурацию LLM (провайдер/URL/модель) в ядро. */
function applyLlmConfig(s: ReaderSettings): void {
  setLlmConfig({ provider: s.llmProvider, url: s.llmUrl, model: s.llmModel });
}

/** Загрузить настройки из хранилища в стор. */
export async function initSettings(): Promise<void> {
  const s = await loadSettings();
  settings.set(s);
  applyLlmConfig(s);
}

/** Обновить настройки (частично) и сохранить. */
export function patchSettings(patch: Partial<ReaderSettings>): void {
  settings.update((s) => ({ ...s, ...patch }));
  const s = get(settings);
  void saveSettings(s);
  applyLlmConfig(s);
}
