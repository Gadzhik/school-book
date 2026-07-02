/**
 * Синхронизация словаря «Мои слова» с сервером (Фаза 5, ТЗ 4.4).
 * Дельта-обмен по метке времени: отправляем локальные изменения,
 * забираем чужие, сливаем по last-write-wins (тумбстоуны — для удалений).
 * Всё опционально: нет подключения — тихо ничего не делаем.
 */
import { get } from 'svelte/store';
import { wordsChangedSince, applyWordSync } from '@reader/core';
import type { WordSyncItem } from '@reader/network';
import { currentClient } from './store';
import { session } from './auth';
import { refreshWords } from '../words/store';

/**
 * Метка последнего синка — per-account (Часть 6: словарь на сервере скоупится
 * по JWT). При смене пользователя метка своя → первый синк нового аккаунта
 * полный (все локальные слова уходят в его скоуп, его серверные — забираются).
 */
function lastSyncKey(): string {
  return `reader:wordsSync:${get(session)?.user.id ?? 'anon'}`;
}

function readLastSync(): number {
  try {
    return Number(localStorage.getItem(lastSyncKey())) || 0;
  } catch {
    return 0;
  }
}

function writeLastSync(ts: number): void {
  try {
    localStorage.setItem(lastSyncKey(), String(ts));
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
