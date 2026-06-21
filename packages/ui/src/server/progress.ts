/**
 * Синхронизация прогресса чтения с сервером (Фаза 5, ТЗ 4.4):
 * «продолжить на любом устройстве». Разрешение конфликтов — last-write-wins
 * по меткам времени на устройство. Всё опционально: нет сервера/serverId —
 * работаем чисто локально (офлайн-первый клиент).
 */
import { updateBook, type BookMeta } from '@reader/core';
import {
  getDeviceId,
  mergeProgress,
  openProgressSocket,
  type DeviceProgress,
  type ProgressSocket,
} from '@reader/network';
import { currentClient, currentServer } from './store';

/** Анти-спам: не чаще одной отправки прогресса на книгу за интервал. */
const PUSH_THROTTLE_MS = 4000;
const lastPush = new Map<string, number>();

/**
 * Отправить прогресс на сервер (троттлинг). Тихо игнорирует отсутствие
 * подключения/serverId и сетевые ошибки. force — отправить немедленно
 * (например, при закрытии книги).
 */
export async function pushProgress(
  book: BookMeta,
  fraction: number,
  locator: string | undefined,
  force = false,
): Promise<void> {
  if (!book.serverId) return;
  const client = currentClient();
  if (!client) return;

  const now = Date.now();
  const prev = lastPush.get(book.serverId) ?? 0;
  if (!force && now - prev < PUSH_THROTTLE_MS) return;
  lastPush.set(book.serverId, now);

  const dp: DeviceProgress = {
    bookId: book.serverId,
    deviceId: getDeviceId(),
    progress: fraction,
    locator,
    updatedAt: now,
  };
  try {
    await client.putProgress(dp);
  } catch {
    /* офлайн — синхронизируемся при следующей возможности */
  }
}

/**
 * Забрать прогресс с сервера и слить с локальным (LWW). Если серверная
 * версия новее — обновляет локальные метаданные и возвращает локатор, с
 * которого открыть книгу. Иначе — undefined (открываем с локальной позиции).
 */
export async function pullProgress(book: BookMeta): Promise<string | undefined> {
  if (!book.serverId) return undefined;
  const client = currentClient();
  if (!client) return undefined;

  const remote = await client.getProgress(book.serverId);
  if (!remote) return undefined;

  const local: DeviceProgress = {
    bookId: book.serverId,
    deviceId: getDeviceId(),
    progress: book.progress ?? 0,
    locator: book.locator,
    updatedAt: book.lastOpenedAt ?? book.addedAt,
  };
  const winner = mergeProgress(local, remote);
  if (winner !== remote) return undefined; // локальная позиция свежее/равна

  await updateBook(book.id, { progress: remote.progress, locator: remote.locator });
  return remote.locator;
}

/** Обновление прогресса с другого устройства (для UI «продолжить отсюда»). */
export interface RemoteProgress {
  fraction: number;
  locator?: string;
}

/**
 * Подписаться на живые обновления прогресса книги с других устройств
 * (WebSocket). Колбэк зовётся только для этой книги (по serverId) и не для
 * собственного устройства. Возвращает объект с close() (null — не подписаны).
 */
export function subscribeProgress(
  book: BookMeta,
  onRemote: (p: RemoteProgress) => void,
): ProgressSocket | null {
  if (!book.serverId) return null;
  const conn = currentServer();
  if (!conn) return null;

  const myDevice = getDeviceId();
  return openProgressSocket(conn.server, {
    token: conn.token,
    onProgress: (p) => {
      if (p.bookId !== book.serverId || p.deviceId === myDevice) return;
      onRemote({ fraction: p.progress, locator: p.locator });
    },
  });
}
