/**
 * Синхронизация словаря «Мои слова» с сервером (Фаза 5, ТЗ 4.4).
 * Дельта-обмен по метке времени: отправляем локальные изменения,
 * забираем чужие, сливаем по last-write-wins (тумбстоуны — для удалений).
 * Всё опционально: нет подключения — тихо ничего не делаем.
 */
import { wordsChangedSince, applyWordSync } from '@reader/core';
import type { WordSyncItem } from '@reader/network';
import { currentClient } from './store';
import { refreshWords } from '../words/store';

const LAST_SYNC_KEY = 'reader:wordsSync';

function readLastSync(): number {
  try {
    return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastSync(ts: number): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
  } catch {
    /* нет localStorage — ок */
  }
}

export interface WordsSyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
}

/**
 * Выполнить двусторонний синк «Моих слов». Возвращает счётчики;
 * при отсутствии сервера/ошибке — { ok:false }.
 */
export async function syncWords(): Promise<WordsSyncResult> {
  const client = currentClient();
  if (!client) return { ok: false, pushed: 0, pulled: 0 };

  const since = readLastSync();
  const startedAt = Date.now();
  try {
    // Отправляем локальные изменения.
    const local = await wordsChangedSince(since);
    if (local.length) await client.pushWords(local as WordSyncItem[]);

    // Забираем чужие изменения и сливаем (LWW).
    const remote = await client.pullWords(since);
    await applyWordSync(remote);

    writeLastSync(startedAt);
    await refreshWords();
    return { ok: true, pushed: local.length, pulled: remote.length };
  } catch {
    return { ok: false, pushed: 0, pulled: 0 };
  }
}
