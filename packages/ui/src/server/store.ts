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
import { importServerBook, books } from '../stores';

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
/**
 * JWT текущей сессии (ставит auth.ts при входе/выходе). Запросы каталога/
 * скачивания идут с ним — иначе сервер не опознаёт пользователя и отдаёт
 * только «доступные всем» книги (фильтр по классу/предмету не работает).
 * Фолбэк — токен пэйринга подключения (для серверов с кодом доступа без
 * аккаунтов).
 */
export const authToken = writable<string | undefined>(undefined);
/** Статус сервера после успешного пинга. */
export const serverStatus = writable<ServerStatus | null>(null);
/** Идёт подключение/загрузка статуса. */
export const connecting = writable(false);
/** Ошибка подключения (текст для UI). */
export const connectError = writable('');

/** Текущий OPDS-фид и его URL (для абсолютизации ссылок). */
export const catalog = writable<{ feed: OpdsFeed; url: string } | null>(null);
/**
 * Стек путей OPDS-навигации (последний — текущий экран каталога). Нужен для
 * кнопки «Назад» внутри каталога: навигация по разделам — внутренний стейт,
 * а не смена view, поэтому свайп-назад без стека сразу выходил в библиотеку.
 */
export const catalogStack = writable<string[]>([]);
/** Можно ли вернуться на предыдущий экран каталога. */
export const canCatalogBack = writable(false);
catalogStack.subscribe((s) => canCatalogBack.set(s.length > 1));
/** Идентификаторы книг, что сейчас скачиваются. */
export const downloading = writable<Set<string>>(new Set());
/**
 * Число доступных пользователю книг на сервере, ещё не скачанных локально.
 * Для бейджа-сигнала в меню («появились доступные книги»).
 */
export const availableCount = writable(0);

/** Построить клиента из текущего подключения (null — не подключён). */
export function currentClient(): LibraryServerClient | null {
  const conn = get(connection);
  if (!conn) return null;
  // JWT сессии важнее токена пэйринга — сервер опознаёт пользователя и фильтрует
  // каталог по правам (класс/предмет/доступна-всем).
  const token = get(authToken) ?? conn.token;
  return new LibraryServerClient({ baseUrl: conn.baseUrl, name: conn.name }, { token });
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
    void refreshAvailable();
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
  catalogStack.set([]);
  availableCount.set(0);
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
export async function openCatalog(path = '/opds/all', push = false): Promise<void> {
  const c = client();
  if (!c) return;
  connectError.set('');
  try {
    catalog.set(await c.catalog(path));
    // push=true — заход в подраздел (кладём в стек); иначе — сброс на корень
    // просмотра (обновление/поиск/«Все книги»/«По разделам»).
    catalogStack.update((s) => (push ? [...s, path] : [path]));
  } catch (e) {
    connectError.set(
      e instanceof Error ? `Каталог недоступен: ${e.message}` : 'Каталог недоступен',
    );
  }
}

/** Вернуться на предыдущий экран OPDS-каталога (кнопка/жест «Назад»). */
export async function catalogBack(): Promise<void> {
  const stack = get(catalogStack);
  if (stack.length < 2) return;
  const prev = stack[stack.length - 2];
  const c = client();
  if (!c) return;
  try {
    catalog.set(await c.catalog(prev));
    catalogStack.set(stack.slice(0, -1));
  } catch (e) {
    connectError.set(
      e instanceof Error ? `Каталог недоступен: ${e.message}` : 'Каталог недоступен',
    );
  }
}

/**
 * Обновить счётчик доступных книг (видимых пользователю и ещё не скачанных).
 * Тихо при отсутствии сети/подключения — офлайн-первый клиент.
 */
export async function refreshAvailable(): Promise<void> {
  const c = client();
  if (!c) {
    availableCount.set(0);
    return;
  }
  try {
    const { feed } = await c.catalog('/opds/all');
    const downloaded = new Set(
      get(books).filter((b) => b.serverId).map((b) => b.serverId as string),
    );
    const n = feed.entries.filter(
      (e) => e.acquisitionHref && !downloaded.has(serverIdOf(e)),
    ).length;
    availableCount.set(n);
  } catch {
    /* офлайн — счётчик не трогаем */
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
    void refreshAvailable();
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
    void refreshAvailable(); // одной доступной книгой меньше — обновить бейдж
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
