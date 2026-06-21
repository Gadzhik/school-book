/**
 * Модели синхронизации (ТЗ 4.4): прогресс чтения и «Мои слова».
 * Разрешение конфликтов — last-write-wins по меткам времени (CRDT избыточен).
 */
import type { DeviceProgress, WordSyncItem } from './types';

/** Выбрать «свежую» версию прогресса (LWW). При равенстве — remote. */
export function mergeProgress(
  local: DeviceProgress | undefined,
  remote: DeviceProgress | undefined,
): DeviceProgress | undefined {
  if (!local) return remote;
  if (!remote) return local;
  return remote.updatedAt >= local.updatedAt ? remote : local;
}

/**
 * Слить два набора слов по ключу normalized (LWW по updatedAt).
 * Тумбстоуны (deleted) тоже участвуют: удаление побеждает более старую правку.
 * Возвращает карту normalized → актуальный элемент (вкл. тумбстоуны).
 */
export function mergeWords(
  local: WordSyncItem[],
  remote: WordSyncItem[],
): Map<string, WordSyncItem> {
  const out = new Map<string, WordSyncItem>();
  for (const item of [...local, ...remote]) {
    const cur = out.get(item.normalized);
    if (!cur || item.updatedAt >= cur.updatedAt) out.set(item.normalized, item);
  }
  return out;
}

/** Живые (не удалённые) слова после слияния, отсортированные по слову. */
export function liveWords(merged: Map<string, WordSyncItem>): WordSyncItem[] {
  return [...merged.values()]
    .filter((w) => !w.deleted)
    .sort((a, b) => a.word.localeCompare(b.word, 'ru'));
}

/**
 * Стабильный идентификатор устройства (ТЗ 4.4 — метка времени на устройство).
 * Хранится в localStorage; при отсутствии — генерируется.
 */
export function getDeviceId(storageKey = 'reader:deviceId'): string {
  try {
    const cur = localStorage.getItem(storageKey);
    if (cur) return cur;
    const id = crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(storageKey, id);
    return id;
  } catch {
    // Нет localStorage (SSR/воркер) — эфемерный id.
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
