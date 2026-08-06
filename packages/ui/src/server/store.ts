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
  type UpdateInfo,
} from '@reader/network';
import { log, updateBook } from '@reader/core';
import { importServerBook, syncServerTags, books, refreshLibrary } from '../stores';
import { tr } from '../i18n';

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
  // JWT важнее токена пэйринга: сервер скоупит живой прогресс по аккаунту
  // (сокет с кодом пэйринга видит только legacy-записи без аккаунта).
  const token = get(authToken) ?? conn.token;
  return { server: { baseUrl: conn.baseUrl, name: conn.name }, token };
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
  // JWT приоритетнее кода пэйринга: сервер по нему проверяет видимость книги
  // (can_see) — иначе вошедший пользователь не увидел бы обложек своих книг.
  const token = get(authToken) ?? conn.token;
  if (token) url += `${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
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
    void checkUpdate();
    return true;
  } catch (e) {
    connectError.set(
      e instanceof Error ? tr('Не удалось подключиться: {0}', tr(e.message)) : tr('Не удалось подключиться'),
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
 * Перенести теги из открытого фида на уже скачанные книги. Так класс/предмет
 * доезжают до копий, скачанных до появления тегов в каталоге, и после
 * перетегирования книги на сервере.
 */
async function applyCatalogTags(feed: { feed: { entries: OpdsEntry[] } }): Promise<void> {
  const items = feed.feed.entries
    .filter((e) => e.acquisitionHref)
    .map((e) => ({
      serverId: serverIdOf(e),
      classes: e.classes,
      subjects: e.subjects,
      categories: e.categories,
    }));
  try {
    await syncServerTags(items);
  } catch (e) {
    log.warn('server', 'не удалось перенести теги каталога на скачанные книги', { e });
  }
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
    const feed = await c.catalog(path);
    catalog.set(feed);
    void applyCatalogTags(feed);
    // push=true — заход в подраздел (кладём в стек); иначе — сброс на корень
    // просмотра (обновление/поиск/«Все книги»/«По разделам»).
    catalogStack.update((s) => (push ? [...s, path] : [path]));
  } catch (e) {
    connectError.set(
      e instanceof Error ? tr('Каталог недоступен: {0}', tr(e.message)) : tr('Каталог недоступен'),
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
    const feed = await c.catalog(prev);
    catalog.set(feed);
    void applyCatalogTags(feed);
    catalogStack.set(stack.slice(0, -1));
  } catch (e) {
    connectError.set(
      e instanceof Error ? tr('Каталог недоступен: {0}', tr(e.message)) : tr('Каталог недоступен'),
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
    await reconcilePublished(feed);
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

/**
 * Сверить локальные метки «на сервере» с реальным каталогом. Книги могли
 * удалить с сервера (или метки остались с эпохи автопубликации при импорте,
 * до 2026-07-02) — тогда serverId/serverSynced зависают навсегда и карточки
 * врут «✓ На сервере». Чистим метку у книг, опубликованных этим аккаунтом
 * (serverSynced задан: владелец всегда видит свои книги в каталоге), только
 * под JWT — анонимный каталог показывает лишь «доступные всем», по нему судить
 * о существовании книги нельзя.
 */
async function reconcilePublished(feed: OpdsFeed): Promise<void> {
  if (!get(authToken)) return;
  const onServer = new Set(feed.entries.map((e) => serverIdOf(e)));
  const stale = get(books).filter(
    (b) => b.serverId && b.serverSynced && !onServer.has(b.serverId),
  );
  if (!stale.length) return;
  for (const b of stale) {
    await updateBook(b.id, { serverId: undefined, serverSynced: undefined });
  }
  await refreshLibrary();
}

// --- Обновления приложения (вкладка «Доступно обновление») ---

/** Версия установленного приложения (из package.json web-сборки при билде). */
export function appVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((import.meta as any).env?.VITE_APP_VERSION as string) || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** true, если версия a новее b (сравнение по числовым сегментам). */
export function versionNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** Доступное обновление приложения с сервера (null — нет/не проверяли). */
export const updateInfo = writable<UpdateInfo | null>(null);

/**
 * Проверить наличие обновления на сервере. Показываем только версии новее
 * установленной. Тихо при офлайне — офлайн-первый клиент.
 */
export async function checkUpdate(): Promise<void> {
  const c = client();
  if (!c) {
    updateInfo.set(null);
    return;
  }
  const info = await c.getUpdateInfo();
  updateInfo.set(info && versionNewer(info.version, appVersion()) ? info : null);
}

/**
 * Обновить статус сервера (имя/число видимых книг) без перезагрузки каталога.
 * Иначе счётчик «книг: N» замирал на значении момента подключения.
 */
export async function refreshStatus(): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    serverStatus.set(await c.status());
  } catch {
    /* офлайн — оставляем прежний статус */
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
    void checkUpdate();
  } catch {
    serverStatus.set(null);
    connectError.set(tr('Сервер сейчас недоступен. Подключитесь снова.'));
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
    // Теги из каталога переносим на локальную копию — иначе фильтр библиотеки
    // (класс/предмет/категория) скачанную книгу не увидит.
    await importServerBook(file, serverId, {
      classes: entry.classes,
      subjects: entry.subjects,
      categories: entry.categories,
    });
    void refreshAvailable(); // одной доступной книгой меньше — обновить бейдж
    return true;
  } catch (e) {
    connectError.set(
      e instanceof Error ? tr('Не удалось скачать: {0}', tr(e.message)) : tr('Не удалось скачать книгу'),
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
