/**
 * Офлайн-словарь: загружаемый пак с сервера (ТЗ Часть 1 — «полный словарь
 * подключим позже»). Админ кладёт на сервер файл `library/_dict/ru.json`
 * (формат: {"слово": "определение", …}; несколько смыслов — через \n).
 * Клиент скачивает пак кнопкой в настройках, хранит в OPFS и подключает к
 * core-словарю (registerDictionary) при каждом старте — дальше офлайн.
 */
import { registerDictionary, getDB, isOpfsSupported, type DictEntry } from '@reader/core';
import { currentClient } from './store';
import { tr } from '../i18n';

const DIR = 'dict';

/** Языки, паки которых пробуем подгрузить при старте. */
const LANGS = ['ru', 'en'];

/** Ключ пака в IndexedDB-сторе 'blobs' (фолбэк без OPFS — Android WebView). */
const idbKey = (lang: string) => `dict:${lang}`;

async function dictDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR, { create });
  } catch {
    return null;
  }
}

function toEntries(pack: Record<string, string>): DictEntry[] {
  return Object.entries(pack).map(([word, def]) => ({
    word,
    definitions: String(def).split('\n').filter(Boolean),
  }));
}

/** Прочитать сохранённый пак: OPFS, иначе IndexedDB. null — нет/битый. */
async function readPack(lang: string): Promise<Record<string, string> | null> {
  try {
    const dir = await dictDir(false);
    if (dir) {
      const fh = await dir.getFileHandle(`${lang}.json`);
      const text = await (await fh.getFile()).text();
      return JSON.parse(text) as Record<string, string>;
    }
  } catch {
    /* в OPFS нет — пробуем IndexedDB */
  }
  try {
    const blob = await (await getDB()).get('blobs', idbKey(lang));
    if (!blob) return null;
    return JSON.parse(await blob.text()) as Record<string, string>;
  } catch {
    return null;
  }
}

/** Сохранить пак: OPFS, а без него (Android WebView) — IndexedDB 'blobs'. */
async function writePack(lang: string, pack: Record<string, string>): Promise<void> {
  const json = JSON.stringify(pack);
  const dir = await dictDir(true);
  if (dir) {
    const fh = await dir.getFileHandle(`${lang}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
    return;
  }
  await (await getDB()).put('blobs', new Blob([json], { type: 'application/json' }), idbKey(lang));
}

/** Слов в сохранённых паках по языкам (для настроек). */
export async function installedPackSizes(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const lang of LANGS) {
    const p = await readPack(lang);
    if (p) out[lang] = Object.keys(p).length;
  }
  return out;
}

let initialized = false;

/** Подключить сохранённые паки к словарю (зовётся при старте приложения). */
export async function initDictionaryPacks(): Promise<void> {
  if (initialized) return;
  initialized = true;
  for (const lang of LANGS) {
    const pack = await readPack(lang);
    if (pack) registerDictionary(toEntries(pack));
  }
}

/**
 * Скачать пак с сервера, сохранить и подключить.
 * Возвращает число слов; бросает Error с текстом для UI.
 */
export async function downloadDictionaryPack(lang = 'ru'): Promise<number> {
  const c = currentClient();
  if (!c) throw new Error(tr('Нет подключения к серверу'));
  const pack = await c.dictionaryPack(lang);
  if (!pack) throw new Error(tr('На сервере нет словаря для этого языка'));
  await writePack(lang, pack);
  registerDictionary(toEntries(pack));
  return Object.keys(pack).length;
}
