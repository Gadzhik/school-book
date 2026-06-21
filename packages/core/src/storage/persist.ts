/**
 * Постоянное хранилище.
 * На iOS Safari браузер вытесняет данные сайта при нехватке места (ТЗ 2.4).
 * Просим разрешение на постоянное хранилище, чтобы библиотека не пропадала.
 */

export interface StorageStatus {
  persisted: boolean;
  /** Оценка занятого места, байт. */
  usage?: number;
  /** Оценка доступной квоты, байт. */
  quota?: number;
}

/** Запросить постоянное хранилище у браузера. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/** Текущий статус хранилища (для отображения в интерфейсе). */
export async function getStorageStatus(): Promise<StorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { persisted: false };
  }
  const persisted = navigator.storage.persisted
    ? await navigator.storage.persisted()
    : false;
  let usage: number | undefined;
  let quota: number | undefined;
  if (navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    usage = est.usage;
    quota = est.quota;
  }
  return { persisted, usage, quota };
}
