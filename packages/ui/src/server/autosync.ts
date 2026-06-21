/**
 * Автоматическая синхронизация (ТЗ Часть 6, офлайн-first). Сводит ручные
 * синки в один: слова + закладки/выделения. Запускается при подключении,
 * входе и при возврате сети (событие online). Всё graceful: нет сервера/
 * сессии/сети — тихо пропускаем; накопленные локально изменения уйдут
 * при следующем удачном синке.
 */
import { get } from 'svelte/store';
import { connection } from './store';
import { session } from './auth';
import { syncWords } from './words-sync';
import { syncMarks } from './marks-sync';

let running = false;

/** Прогнать все доступные синки (слова — при подключении; заметки — при сессии). */
export async function syncAll(): Promise<void> {
  if (running) return;
  if (!get(connection)) return;
  running = true;
  try {
    await syncWords();
    if (get(session)?.user.status === 'active') await syncMarks();
  } catch {
    /* офлайн/ошибка — попробуем в следующий раз */
  } finally {
    running = false;
  }
}

let inited = false;

/** Однократно подписаться на возврат сети для авто-синка. */
export function initAutoSync(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  window.addEventListener('online', () => void syncAll());
}
