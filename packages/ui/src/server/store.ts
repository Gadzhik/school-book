/**
 * Состояние подключения к библиотечному серверу (Фаза 5, ТЗ Часть 4).
 * Веб-клиент: ручной ввод адреса / QR-пэйринг, просмотр OPDS-каталога,
 * скачивание книг в локальную библиотеку. Офлайн-первый: подключение
 * опционально, всё уже скачанное читается без сети.
 */
import { writable, get } from 'svelte/store';
import {
  LibraryServerClient,
  parsePairingPayload,
  resolveHref,
  type ServerInfo,
  type ServerStatus,
  type OpdsFeed,
  type OpdsEntry,
} from '@reader/network';
import { importServerBook } from '../stores';

/** Сохранённое подключение (адрес + токен пэйринга). */
interface SavedConnection {
  baseUrl: string;
  name?: string;
  token?: string;
}

const STORE_KEY = 'reader:server';

function loadSaved(): SavedConnection | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as SavedConnection) : null;
  } catch {
    return null;
  }
}

function persist(conn: SavedConnection | null): void {
  try {
    if (conn) localStorage.setItem(STORE_KEY, JSON.stringify(conn));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* нет localStorage — ок */
  }
}

/** Текущее подключение (null — не подключён). */
export const connection = writable<SavedConnection | null>(loadSaved());
/** Статус сервера после успешного пинга. */
export const serverStatus = writable<ServerStatus | null>(null);
/** Идёт подключение/загрузка статуса. */
export const connecting = writable(false);
/** Ошибка подключения (текст для UI). */
export const connectError = writable('');

/** Текущий OPDS-фид и его URL (для абсолютизации ссылок). */
export const catalog = writable<{ feed: OpdsFeed; url: string } | null>(null);
/** Идентификаторы книг, что сейчас скачиваются. */
export const downloading = writable<Set<string>>(new Set());

/** Построить клиента из текущего подключения (null — не подключён). */
export function currentClient(): LibraryServerClient | null {
  const conn = get(connection);
  if (!conn) return null;
  return new LibraryServerClient({ baseUrl: conn.baseUrl, name: conn.name }, { token: conn.token });
}
const client = currentClient;

/** Текущий сервер и токен (для WebSocket-подписки). null — не подключён. */
export function currentServer(): { server: ServerInfo; token?: string } | null {
  const conn = get(connection);
  if (!conn) return null;
  return { server: { baseUrl: conn.baseUrl, name: conn.name }, token: conn.token };
}

/**
 * Абсолютный URL обложки записи каталога (с токеном в query — чтобы работало
 * в <img>). null — нет обложки/не подключён.
 */
export function coverUrl(entry: OpdsEntry): string | null {
  const cat = get(catalog);
  const conn = get(connection);
  if (!entry.coverHref || !cat || !conn) return null;
  let url = resolveHref(entry.coverHref, cat.url);
  if (conn.token) url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(conn.token)}`;
  return url;
}

/**
 * Подключиться по введённому адресу/QR-пэйлоаду. Поддерживает host:port,
 * полный URL и `chitalka://pair?...`. token из формы переопределяет токен пэйлоада.
 */
export async function connect(input: string, token?: string): Promise<boolean> {
  connecting.set(true);
  connectError.set('');
  try {
    const pairing = parsePairingPayload(input);
    const conn: SavedConnection = {
      baseUrl: pairing.baseUrl,
      token: token?.trim() || pairing.token,
    };
    const c = new LibraryServerClient({ baseUrl: conn.baseUrl }, { token: conn.token });
    const status = await c.status();
    conn.name = status.name;
    connection.set(conn);
    serverStatus.set(status);
    persist(conn);
    await openCatalog();
    return true;
  } catch (e) {
    connectError.set(
      e instanceof Error ? `Не удалось подключиться: ${e.message}` : 'Не удалось подключиться',
    );
    return false;
  } finally {
    connecting.set(false);
  }
}

/** Отключиться и забыть сервер. */
export function disconnect(): void {
  connection.set(null);
  serverStatus.set(null);
  catalog.set(null);
  connectError.set('');
  persist(null);
}

/** serverId книги из ссылки скачивания `/books/<id>/file` (для дедупа/прогресса). */
export function serverIdOf(entry: OpdsEntry): string {
  return /\/books\/([^/]+)\/file/.exec(entry.acquisitionHref ?? '')?.[1] ?? entry.id ?? '';
}

/**
 * Загрузить OPDS-каталог. По умолчанию — «Все книги» (сразу видны книги с
 * кнопкой скачивания), чтобы не путать навигацией. Навигация по классам/
 * предметам доступна по ссылкам (openCatalog(href)) и кнопке «По разделам».
 */
export async function openCatalog(path = '/opds/all'): Promise<void> {
  const c = client();
  if (!c) return;
  connectError.set('');
  try {
    catalog.set(await c.catalog(path));
  } catch (e) {
    connectError.set(
      e instanceof Error ? `Каталог недоступен: ${e.message}` : 'Каталог недоступен',
    );
  }
}

/** Поиск книг в каталоге по названию/автору. Пустой запрос → корневой каталог. */
export async function searchCatalog(query: string): Promise<void> {
  const q = query.trim();
  if (!q) {
    await openCatalog();
    return;
  }
  await openCatalog(`/opds/search?q=${encodeURIComponent(q)}`);
}

/** Восстановить сессию при входе на экран: пингуем сохранённый сервер. */
export async function restoreSession(): Promise<void> {
  const c = client();
  if (!c) return;
  connecting.set(true);
  try {
    const status = await c.status();
    serverStatus.set(status);
    await openCatalog();
  } catch {
    serverStatus.set(null);
    connectError.set('Сервер сейчас недоступен. Подключитесь снова.');
  } finally {
    connecting.set(false);
  }
}

/** Имя файла для скачанной книги (из заголовка + типа). */
function fileNameFor(entry: OpdsEntry): string {
  const base = entry.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'book';
  const ext = entry.acquisitionType?.includes('epub')
    ? 'epub'
    : entry.acquisitionType?.includes('pdf')
      ? 'pdf'
      : entry.acquisitionType?.includes('fictionbook')
        ? 'fb2'
        : 'bin';
  return `${base}.${ext}`;
}

/**
 * Скачать книгу из каталога в локальную библиотеку.
 * Импорт идёт через общий конвейер (addFiles): конвертация при нужде +
 * авторазметка с ревью. Возвращает true при успехе.
 */
export async function downloadEntry(entry: OpdsEntry): Promise<boolean> {
  const cat = get(catalog);
  const c = client();
  if (!c || !cat || !entry.acquisitionHref) return false;
  const key = entry.id || entry.acquisitionHref;
  downloading.update((s) => new Set(s).add(key));
  try {
    const href = c.absolute(entry.acquisitionHref, cat.url);
    const blob = await c.download(href);
    const file = new File([blob], fileNameFor(entry), {
      type: entry.acquisitionType || 'application/octet-stream',
    });
    // serverId книги — из ссылки скачивания `/books/<id>/file` (для синка прогресса).
    const serverId = /\/books\/([^/]+)\/file/.exec(entry.acquisitionHref)?.[1] ?? entry.id;
    await importServerBook(file, serverId);
    return true;
  } catch (e) {
    connectError.set(
      e instanceof Error ? `Не удалось скачать: ${e.message}` : 'Не удалось скачать книгу',
    );
    return false;
  } finally {
    downloading.update((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  }
}
