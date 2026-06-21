/**
 * Сторы «Мои слова» (Фаза 3). Список сохранённых слов, число к повторению,
 * операции сохранения/оценки. Логика SM-2 — в @reader/core.
 */
import { writable } from 'svelte/store';
import {
  listWords,
  getDueWords,
  countDueWords,
  addWord,
  removeWord,
  reviewWord,
  type SavedWord,
  type ReviewGrade,
  type AddWordInput,
} from '@reader/core';

/** Все сохранённые слова. */
export const words = writable<SavedWord[]>([]);
/** Сколько слов готово к повторению (для бейджа). */
export const dueCount = writable(0);

/** Обновить список и счётчик. */
export async function refreshWords(): Promise<void> {
  words.set(await listWords());
  dueCount.set(await countDueWords());
}

/** Сохранить слово (из карточки/попапа). */
export async function saveWord(input: AddWordInput): Promise<void> {
  await addWord(input);
  await refreshWords();
}

/** Удалить слово. */
export async function deleteWord(id: string): Promise<void> {
  await removeWord(id);
  await refreshWords();
}

/** Оценить карточку и обновить счётчики. */
export async function gradeWord(id: string, grade: ReviewGrade): Promise<void> {
  await reviewWord(id, grade);
  await refreshWords();
}

/** Получить очередь слов к повторению. */
export function loadDue(): Promise<SavedWord[]> {
  return getDueWords();
}
