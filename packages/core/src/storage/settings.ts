/**
 * Хранение настроек читалки в IndexedDB (store 'settings', ключ 'reader').
 */
import { getDB } from './db';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../types';

const KEY = 'reader';

/** Загрузить настройки (или вернуть значения по умолчанию). */
export async function loadSettings(): Promise<ReaderSettings> {
  const db = await getDB();
  const saved = await db.get('settings', KEY);
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

/** Сохранить настройки. */
export async function saveSettings(settings: ReaderSettings): Promise<void> {
  const db = await getDB();
  await db.put('settings', settings, KEY);
}
