/**
 * Сторы и логика классификации (ТЗ Часть 5): словари, фасетный фильтр,
 * смарт-полки, ручное тегирование. Опирается на API @reader/core.
 */
import { writable, derived, type Readable } from 'svelte/store';
import {
  listClasses,
  listSubjects,
  listCategories,
  matchesFacets,
  setBookTags,
  toggleBookTag,
  classifyBookLLM,
  isLlmAvailable,
  type ClassEntry,
  type SubjectEntry,
  type CategoryEntry,
  type FacetFilter,
  type Facet,
  type BookMeta,
} from '@reader/core';
import { get } from 'svelte/store';
import { books, refreshLibrary } from './stores';

/** Словари (загружаются из IndexedDB при входе в библиотеку). */
export const classes = writable<ClassEntry[]>([]);
export const subjects = writable<SubjectEntry[]>([]);
export const categories = writable<CategoryEntry[]>([]);

/** Загрузить словари в сторы. */
export async function loadTaxonomy(): Promise<void> {
  classes.set(await listClasses());
  subjects.set(await listSubjects());
  categories.set(await listCategories());
}

/** Текущий фасетный фильтр библиотеки. */
export const facetFilter = writable<FacetFilter>({});

/** Книги после применения фильтра. */
export const filteredBooks: Readable<BookMeta[]> = derived(
  [books, facetFilter],
  ([$books, $f]) => $books.filter((b) => matchesFacets(b, $f)),
);

/** Активно ли хоть одно ограничение фильтра. */
export const filterActive: Readable<boolean> = derived(facetFilter, ($f) =>
  Boolean(
    $f.categories?.length ||
      $f.classes?.length ||
      $f.subjects?.length ||
      $f.tags?.length ||
      $f.query?.trim(),
  ),
);

/** Переключить значение фасета в фильтре. */
export function toggleFilter(dim: Facet, value: string): void {
  facetFilter.update((f) => {
    const set = new Set(f[dim] ?? []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return { ...f, [dim]: [...set] };
  });
}

/** Установить поисковый запрос. */
export function setQuery(q: string): void {
  facetFilter.update((f) => ({ ...f, query: q }));
}

/** Применить фильтр целиком (для смарт-полок и пресетов). */
export function applyFilter(f: FacetFilter): void {
  facetFilter.set(f);
}

/** Сбросить фильтр. */
export function clearFilter(): void {
  facetFilter.set({});
}

// --- Смарт-полки: автоматические подборки по тому, что реально есть ---

export interface SmartShelf {
  label: string;
  filter: FacetFilter;
  count: number;
}

/**
 * Смарт-полки строятся из текущих книг: по классам и предметам, где есть
 * хотя бы одна книга. Обновляются автоматически (derived от books+словарей).
 */
export const smartShelves: Readable<SmartShelf[]> = derived(
  [books, classes, subjects],
  ([$books, $classes, $subjects]) => {
    const shelves: SmartShelf[] = [];
    for (const c of $classes) {
      const count = $books.filter((b) => (b.classes ?? []).includes(c.id)).length;
      if (count > 0) shelves.push({ label: c.label, filter: { classes: [c.id] }, count });
    }
    for (const s of $subjects) {
      const count = $books.filter((b) => (b.subjects ?? []).includes(s.id)).length;
      if (count > 0) shelves.push({ label: s.name, filter: { subjects: [s.id] }, count });
    }
    return shelves;
  },
);

// --- Ручное тегирование книги ---

/** Задать наборы тегов книги и обновить библиотеку. */
export async function tagBook(id: string, patch: Partial<Pick<BookMeta, Facet>>): Promise<void> {
  await setBookTags(id, patch);
  await refreshLibrary();
}

/** Переключить один тег книги и обновить библиотеку. */
export async function toggleBookTagAndRefresh(
  id: string,
  facet: Facet,
  value: string,
): Promise<void> {
  await toggleBookTag(id, facet, value);
  await refreshLibrary();
}

/** Результат запроса к локальной LLM (ТЗ 5.4 источник #3). */
export interface LlmSuggestResult {
  /** Был ли доступен Ollama и получен ответ. */
  ok: boolean;
  /** Сколько новых тегов добавлено (объединением, без перезаписи). */
  added: number;
}

/**
 * Предложить теги книги через локальную LLM (Ollama) и ДОБАВИТЬ их к
 * текущим (объединение, не перезапись — пользователь сам уберёт лишнее).
 * Graceful: если Ollama недоступен — { ok:false, added:0 }.
 */
export async function suggestWithLLM(id: string): Promise<LlmSuggestResult> {
  const book = get(books).find((b) => b.id === id);
  if (!book) return { ok: false, added: 0 };

  const tags = await classifyBookLLM({
    title: book.title,
    author: book.author,
    fileName: book.fileName,
  });
  const got = tags.classes.length + tags.subjects.length + tags.categories.length;
  if (got === 0) {
    // Пустой ответ: явно отличаем недоступность ИИ от «нечего предложить».
    return { ok: await isLlmAvailable(), added: 0 };
  }

  const union = (cur: string[] | undefined, add: string[]): string[] => [
    ...new Set([...(cur ?? []), ...add]),
  ];
  const before =
    (book.classes?.length ?? 0) + (book.subjects?.length ?? 0) + (book.categories?.length ?? 0);
  const patch = {
    classes: union(book.classes, tags.classes),
    subjects: union(book.subjects, tags.subjects),
    categories: union(book.categories, tags.categories),
  };
  await setBookTags(id, patch);
  await refreshLibrary();
  const after = patch.classes.length + patch.subjects.length + patch.categories.length;
  return { ok: true, added: after - before };
}
