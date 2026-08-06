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
  tagsSignature,
  DEFAULT_SETTINGS,
  log,
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

/** Два вида указывают на один экран (для reader сравниваем и книгу). */
function sameView(a: ViewState, b: ViewState): boolean {
  if (a.name !== b.name) return false;
  if (a.name === 'reader' && b.name === 'reader') return a.bookId === b.bookId;
  return true;
}

/** Запись в history.state: вид + глубина стека (library = корень, depth 0). */
interface HistEntry {
  view: ViewState;
  depth: number;
}

/**
 * Связывает store `view` с History API. Зачем: на Android wry мостит
 * аппаратную/жестовую «Назад» на `webView.goBack()` при `canGoBack()`, иначе
 * сворачивает приложение. Наш роутинг — плоский store без history, поэтому
 * `canGoBack()` всегда false → любое «Назад» сворачивало приложение.
 *
 * Здесь каждый переход «вперёд» (открыть книгу, словарь, сервер…) кладёт запись
 * в историю, а возврат в библиотеку схлопывает стек через `history.go`, чтобы
 * не плодить дубли. «Назад» (жест/кнопка браузера) → `popstate` → нужный вид.
 * Вызывается один раз при старте (см. main.ts).
 */
export function initHistoryNavigation(): void {
  if (typeof window === 'undefined' || !window.history) return;

  let internal = false; // защита от рекурсии view → history → view
  let skipNextPop = false; // popstate, вызванный нашим же history.go(...)

  // Корень истории — всегда библиотека. Если восстановили открытую книгу,
  // кладём её отдельной записью поверх корня, чтобы «Назад» вёл в библиотеку.
  const restored = get(view);
  history.replaceState({ view: { name: 'library' }, depth: 0 } as HistEntry, '');
  if (restored.name !== 'library') {
    history.pushState({ view: restored, depth: 1 } as HistEntry, '');
  }

  view.subscribe((v) => {
    if (internal) return;
    const cur = (history.state as HistEntry | null) ?? null;
    if (cur && sameView(cur.view, v)) return; // вид уже соответствует записи

    const depth = cur?.depth ?? 0;
    if (v.name === 'library' && depth > 0) {
      // Возврат в корень: идём назад по истории, а не плодим записи.
      skipNextPop = true;
      history.go(-depth);
    } else {
      history.pushState({ view: v, depth: depth + 1 } as HistEntry, '');
    }
  });

  window.addEventListener('popstate', (e) => {
    const entry = (e.state as HistEntry | null) ?? { view: { name: 'library' }, depth: 0 };
    internal = true;
    view.set(entry.view);
    internal = false;
    skipNextPop = false;
  });
}

/**
 * Назад на предыдущий экран (кнопка «Назад» в шапках). Через History API,
 * чтобы возвращаться туда, откуда пришли (например, книга открыта из сетевой
 * библиотеки → назад в неё, а не в локальную). Без нашей истории — в библиотеку.
 */
export function goBack(): void {
  const cur = history.state as HistEntry | null;
  if (cur && cur.depth > 0) history.back();
  else view.set({ name: 'library' });
}

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

/** Добавить файлы в библиотеку и обновить список. Возвращает импортированные
 *  книги (нужно вызывающему, напр. для публикации на сервер). */
export async function addFiles(files: FileList | File[]): Promise<BookMeta[]> {
  const review: ImportReviewItem[] = [];
  const added: BookMeta[] = [];
  const preferPandoc = get(settings).pandocDocs;
  for (const file of Array.from(files)) {
    const started = Date.now();
    try {
      log.info('import', 'импорт файла', { имя: file.name, размер: file.size, тип: file.type });
      const res = await importFile(file, { preferPandoc });
      added.push(res.book);
      collectReview(res, review);
      log.info('import', 'книга добавлена', {
        имя: file.name,
        формат: res.book.format,
        id: res.book.id,
        мс: Date.now() - started,
      });
    } catch (err) {
      log.error('import', 'не удалось добавить файл', { имя: file.name, размер: file.size, err });
    }
  }
  await refreshLibrary();
  if (review.length) importReview.update((cur) => [...review, ...cur]);
  return added;
}

/** Теги книги, пришедшие из каталога сервера (класс/предмет/категория). */
export interface ServerBookTags {
  classes?: string[];
  subjects?: string[];
  categories?: string[];
}

/**
 * Объединить локальные (авто)теги с тегами сервера — не теряем ни то, ни другое.
 * Порядок: сначала серверные (они точнее — их выставил учитель), потом свои.
 */
function mergeTags(local: string[] | undefined, fromServer: string[] | undefined): string[] {
  return [...new Set([...(fromServer ?? []), ...(local ?? [])])];
}

/**
 * Патч тегов книги по данным сервера. Пустой, если сервер тегов не прислал или
 * всё уже совпадает — тогда книгу не переписываем.
 *
 * Если после слияния теги книги в точности равны серверным, ставим и
 * `serverSynced`: копия соответствует серверу, и карточка показывает
 * «✓ На сервере», а не вечное «Обновить на сервере» (метку до этого выставляла
 * только публикация с ЭТОГО устройства, поэтому скачанная книга не могла её
 * получить никогда).
 */
function tagPatch(book: BookMeta, tags: ServerBookTags | undefined): Partial<BookMeta> {
  if (!tags) return {};
  const patch: Partial<BookMeta> = {};
  const merged: ServerBookTags = {};
  for (const dim of ['classes', 'subjects', 'categories'] as const) {
    merged[dim] = mergeTags(book[dim], tags[dim]);
    if (merged[dim].length !== (book[dim] ?? []).length) patch[dim] = merged[dim];
  }
  const sig = tagsSignature(merged);
  if (sig === tagsSignature(tags) && book.serverSynced !== sig) patch.serverSynced = sig;
  return patch;
}

/**
 * Подтянуть теги каталога на уже скачанные книги (сопоставление по serverId).
 * Нужно для копий, скачанных версией без тегов в фиде, и после перетегирования
 * книги на сервере — иначе фасетный фильтр библиотеки их не находит.
 */
export async function syncServerTags(
  items: Array<{ serverId: string } & ServerBookTags>,
): Promise<void> {
  const byId = new Map(items.filter((i) => i.serverId).map((i) => [i.serverId, i]));
  if (!byId.size) return;
  let changed = false;
  for (const book of await listBooks()) {
    const tags = book.serverId ? byId.get(book.serverId) : undefined;
    if (!tags) continue;
    const patch = tagPatch(book, tags);
    if (!Object.keys(patch).length) continue;
    await updateBook(book.id, patch);
    changed = true;
  }
  if (changed) await refreshLibrary();
}

/**
 * Импортировать книгу, скачанную с сервера (Фаза 5): как обычный импорт,
 * плюс сохраняем serverId для синхронизации прогресса между устройствами и
 * теги из каталога (класс/предмет/категория) — иначе скачанную книгу не находит
 * фасетный фильтр библиотеки на этом устройстве.
 */
export async function importServerBook(
  file: File,
  serverId: string,
  tags?: ServerBookTags,
): Promise<void> {
  // Дедуп: если книга с этим serverId уже скачана — не создаём копию.
  // (addBook в ядре каждый раз даёт новый id, иначе повторное скачивание
  // плодило бы дубликаты одной и той же книги.)
  // Теги при этом всё же подтягиваем: книга могла быть скачана старой версией
  // (без тегов) или перетегирована на сервере после скачивания.
  if (serverId) {
    const already = (await listBooks()).find((b) => b.serverId === serverId);
    if (already) {
      const patch = tagPatch(already, tags);
      if (Object.keys(patch).length) {
        await updateBook(already.id, patch);
        await refreshLibrary();
      }
      return;
    }
  }
  const review: ImportReviewItem[] = [];
  try {
    const res = await importFile(file);
    await updateBook(res.book.id, { serverId, ...tagPatch(res.book, tags) });
    collectReview(res, review);
  } catch (err) {
    log.error('import', 'не удалось импортировать книгу с сервера', {
      имя: file.name,
      serverId,
      err,
    });
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
