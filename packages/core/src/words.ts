/**
 * «Мои слова» + карточки с интервальным повторением (ТЗ Часть 1, Фаза 3).
 * Алгоритм — упрощённый SM-2 (как в Anki): успешные ответы растягивают
 * интервал, «не помню» сбрасывает. Всё локально (IndexedDB), без облака.
 */
import { getDB } from './storage/db';
import { normalizeWord } from './dictionary';
import { hyphenateSyllables } from './syllables';
import type { SavedWord, ReviewGrade, WordSyncDelta } from './types';

const DAY = 24 * 60 * 60 * 1000;

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface AddWordInput {
  word: string;
  definition?: string;
  bookId?: string;
}

/**
 * Добавить слово в «Мои слова». Если слово уже есть (по нормализованной форме) —
 * вернуть существующее, не дублируя.
 */
export async function addWord(input: AddWordInput): Promise<SavedWord> {
  const db = await getDB();
  const normalized = normalizeWord(input.word);
  const existing = (await db.getAll('words')).find((w) => w.normalized === normalized);
  const now = Date.now();
  if (existing) {
    // Уже было удалено (тумбстоун) — возрождаем; иначе возвращаем как есть.
    if (existing.deleted) {
      const revived: SavedWord = { ...existing, deleted: false, updatedAt: now };
      await db.put('words', revived);
      return revived;
    }
    return existing;
  }

  const entry: SavedWord = {
    id: uid(),
    word: input.word.trim(),
    normalized,
    definition: input.definition,
    syllables: hyphenateSyllables(input.word.trim()),
    bookId: input.bookId,
    addedAt: now,
    updatedAt: now,
    due: now, // готово к первому повторению сразу
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
  };
  await db.put('words', entry);
  return entry;
}

/** Все сохранённые слова (новые сверху), без удалённых. */
export async function listWords(): Promise<SavedWord[]> {
  const db = await getDB();
  const all = await db.getAll('words');
  return all.filter((w) => !w.deleted).sort((a, b) => b.addedAt - a.addedAt);
}

/** Слова, готовые к повторению (due <= сейчас), самые «просроченные» первыми. */
export async function getDueWords(now = Date.now()): Promise<SavedWord[]> {
  const db = await getDB();
  const all = await db.getAll('words');
  return all.filter((w) => !w.deleted && w.due <= now).sort((a, b) => a.due - b.due);
}

/** Сколько слов готово к повторению. */
export async function countDueWords(now = Date.now()): Promise<number> {
  return (await getDueWords(now)).length;
}

/**
 * Удалить слово. Мягкое удаление (тумбстоун), чтобы удаление
 * синхронизировалось с другими устройствами (Фаза 5). Запись остаётся в БД
 * помеченной deleted и не показывается в списках.
 */
export async function removeWord(id: string): Promise<void> {
  const db = await getDB();
  const w = await db.get('words', id);
  if (!w) return;
  await db.put('words', { ...w, deleted: true, updatedAt: Date.now() });
}

/**
 * Применить SM-2 к слову по оценке ответа и сохранить.
 * - again: забыл → сброс серии, повтор через 1 день, ease понижается.
 * - good: вспомнил → интервал растёт по ease.
 * - easy: легко → интервал растёт сильнее, ease повышается.
 */
export async function reviewWord(
  id: string,
  grade: ReviewGrade,
  now = Date.now(),
): Promise<SavedWord | undefined> {
  const db = await getDB();
  const w = await db.get('words', id);
  if (!w) return undefined;

  let { ease, reps, interval, lapses } = w;

  if (grade === 'again') {
    reps = 0;
    lapses += 1;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    reps += 1;
    if (reps === 1) interval = grade === 'easy' ? 4 : 1;
    else if (reps === 2) interval = grade === 'easy' ? 10 : 6;
    else interval = Math.round(interval * ease * (grade === 'easy' ? 1.3 : 1));
    if (grade === 'easy') ease += 0.15;
    else ease = Math.max(1.3, ease - 0.02);
  }

  const updated: SavedWord = {
    ...w,
    ease,
    reps,
    interval,
    lapses,
    due: now + interval * DAY,
    updatedAt: now,
  };
  await db.put('words', updated);
  return updated;
}

// --- Экспорт «Моих слов» (ТЗ Часть 3, п.10) ---

/** Дата epoch ms → YYYY-MM-DD. */
function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Экранировать значение для CSV (RFC 4180). */
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Экспорт слов в CSV (для Excel/учёбы). Удалённые не включаются. */
export function wordsToCsv(words: SavedWord[]): string {
  const header = ['Слово', 'Слоги', 'Определение', 'Добавлено', 'Повторений', 'Забываний'];
  const rows = words
    .filter((w) => !w.deleted)
    .map((w) =>
      [w.word, w.syllables ?? '', w.definition ?? '', ymd(w.addedAt), String(w.reps), String(w.lapses)]
        .map(csvCell)
        .join(','),
    );
  return [header.join(','), ...rows].join('\r\n');
}

/** Экспорт слов в Markdown (для заметок/учёбы). Удалённые не включаются. */
export function wordsToMarkdown(words: SavedWord[]): string {
  const lines = ['# Мои слова', ''];
  for (const w of words.filter((x) => !x.deleted)) {
    const syll = w.syllables ? ` _(${w.syllables})_` : '';
    lines.push(`- **${w.word}**${syll}${w.definition ? ` — ${w.definition}` : ''}`);
  }
  return lines.join('\n');
}

// --- Синхронизация с сервером (Фаза 5, ТЗ 4.4) ---

/** Метка последнего изменения записи (старые записи — addedAt). */
function wordTs(w: SavedWord): number {
  return w.updatedAt ?? w.addedAt;
}

/** Локальные изменения слов после метки since — для отправки на сервер. */
export async function wordsChangedSince(since: number): Promise<WordSyncDelta[]> {
  const db = await getDB();
  const all = await db.getAll('words');
  return all
    .filter((w) => wordTs(w) > since)
    .map((w) => ({
      normalized: w.normalized,
      word: w.word,
      definition: w.definition,
      updatedAt: wordTs(w),
      deleted: w.deleted ?? false,
    }));
}

/**
 * Применить присланные сервером изменения (LWW по updatedAt, ключ normalized).
 * Новое слово создаётся с дефолтными параметрами SM-2; существующее
 * обновляется только если входящая версия не старее.
 */
export async function applyWordSync(items: WordSyncDelta[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const all = await db.getAll('words');
  const byNorm = new Map(all.map((w) => [w.normalized, w]));
  const tx = db.transaction('words', 'readwrite');
  for (const it of items) {
    const cur = byNorm.get(it.normalized);
    if (cur) {
      if (it.updatedAt < wordTs(cur)) continue; // локальная версия свежее
      await tx.store.put({
        ...cur,
        word: it.word,
        definition: it.definition,
        deleted: it.deleted ?? false,
        updatedAt: it.updatedAt,
      });
    } else {
      // Тумбстоун неизвестного слова не материализуем.
      if (it.deleted) continue;
      const now = it.updatedAt;
      await tx.store.put({
        id: uid(),
        word: it.word,
        normalized: it.normalized,
        definition: it.definition,
        syllables: hyphenateSyllables(it.word),
        addedAt: now,
        updatedAt: now,
        due: now,
        interval: 0,
        ease: 2.5,
        reps: 0,
        lapses: 0,
      });
    }
  }
  await tx.done;
}
