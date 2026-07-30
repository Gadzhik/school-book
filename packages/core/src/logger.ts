/**
 * Журнал приложения (клиентская часть).
 *
 * Один механизм на все сборки: веб, десктоп и Android — это один и тот же
 * Svelte-код внутри браузера или WebView Tauri, поэтому логгер живёт здесь,
 * в @reader/core, а не в оболочках.
 *
 * Что делает:
 *   - пишет записи в кольцевой буфер в памяти и в IndexedDB (стор `logs`),
 *     чтобы журнал пережил перезагрузку страницы и падение вкладки;
 *   - перехватывает необработанные ошибки (`error`, `unhandledrejection`) и
 *     `console.error/warn` — то, что раньше просто утекало в консоль;
 *   - хранит контекст запуска (платформа, версия, экран, UA) — без него запись
 *     «не открылась книга» бесполезна;
 *   - отдаёт накопленное наружу: выгрузка файлом (NDJSON) и порционная отдача
 *     для отправки на школьный сервер (см. `takeForUpload`).
 *
 * Логгер намеренно не знает про сеть и UI: отправкой занимается слой выше
 * (@reader/ui + @reader/network), иначе core начал бы зависеть от транспорта.
 */
import { getDB } from './storage/db';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Порядок уровней для фильтрации (чем больше, тем важнее). */
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Одна запись журнала. */
export interface LogEntry {
  /** Ключ в IndexedDB (автоинкремент). У записей в памяти может отсутствовать. */
  seq?: number;
  /** Время события (мс эпохи). */
  ts: number;
  level: LogLevel;
  /** Подсистема: `app`, `reader`, `import`, `net`, `sync`, `ocr`, `ui`, `native`. */
  scope: string;
  msg: string;
  /** Детали (сериализуются безопасно, глубина и объём ограничены). */
  data?: unknown;
  /** Идентификатор запуска приложения — склеивает записи одной сессии. */
  session: string;
}

/** Контекст запуска: попадает в шапку выгрузки и в первую запись сессии. */
export interface LogContext {
  session: string;
  /** Где выполняемся: браузер, десктопная оболочка Tauri, Android/iOS. */
  platform: 'web' | 'desktop' | 'android' | 'ios' | 'unknown';
  appVersion: string;
  userAgent: string;
  language: string;
  screen: string;
  startedAt: number;
}

/** Сколько записей держим в IndexedDB (старые вытесняются). */
const MAX_STORED = 5000;
/** Сколько записей держим в памяти для быстрого показа в настройках. */
const MAX_MEMORY = 500;
/** Ограничители сериализации деталей — чтобы лог не раздувался книгой целиком. */
const MAX_DEPTH = 4;
const MAX_STRING = 2000;
const MAX_ARRAY = 50;

let context: LogContext = {
  session: makeSessionId(),
  platform: 'unknown',
  appVersion: 'unknown',
  userAgent: '',
  language: '',
  screen: '',
  startedAt: Date.now(),
};

let minLevel: LogLevel = 'debug';
let installed = false;
let persistEnabled = true;
const memory: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();
/** Очередь на запись в IndexedDB: пишем пачками, чтобы не дёргать БД на каждый чих. */
let pendingWrites: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
/** Оригинальные методы консоли — через них пишем сами, иначе рекурсия. */
const rawConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
/** Флаг «мы сейчас внутри своего же console.*» — защита от рекурсии. */
let inside = false;

function makeSessionId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${rnd}`;
}

/** Определить платформу по признакам оболочки Tauri и UA. */
function detectPlatform(): LogContext['platform'] {
  if (typeof window === 'undefined') return 'unknown';
  const w = window as unknown as Record<string, unknown>;
  const isTauri = '__TAURI__' in w || '__TAURI_INTERNALS__' in w;
  const ua = navigator.userAgent ?? '';
  if (/android/i.test(ua)) return isTauri ? 'android' : 'web';
  if (/iphone|ipad|ipod/i.test(ua)) return isTauri ? 'ios' : 'web';
  return isTauri ? 'desktop' : 'web';
}

/**
 * Безопасная сериализация деталей: ошибки разворачиваем в имя/сообщение/стек,
 * строки и массивы подрезаем, циклы не роняют JSON.stringify.
 */
function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING})` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return String(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: typeof value.stack === 'string' ? value.stack.slice(0, MAX_STRING) : undefined,
      cause: value.cause !== undefined && depth < MAX_DEPTH ? sanitize(value.cause, depth + 1, seen) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const obj = value as object;
    if (seen.has(obj)) return '[циклическая ссылка]';
    if (depth >= MAX_DEPTH) return '[…]';
    seen.add(obj);
    if (Array.isArray(value)) {
      const head = value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1, seen));
      return value.length > MAX_ARRAY ? [...head, `…(+${value.length - MAX_ARRAY})`] : head;
    }
    // Blob/File/ArrayBuffer логируем метаданными, а не содержимым.
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return { тип: 'Blob', size: value.size, mime: value.type };
    }
    if (value instanceof ArrayBuffer) return { тип: 'ArrayBuffer', byteLength: value.byteLength };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitize(v, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

/** Отложенный сброс накопленных записей в IndexedDB. */
function scheduleFlush(): void {
  if (flushTimer || !persistEnabled) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushToDb();
  }, 1000);
}

async function flushToDb(): Promise<void> {
  if (!pendingWrites.length || !persistEnabled) return;
  const batch = pendingWrites;
  pendingWrites = [];
  try {
    const db = await getDB();
    const tx = db.transaction('logs', 'readwrite');
    for (const e of batch) {
      // seq назначает сама IndexedDB (autoIncrement) — из записи его убираем.
      const { seq: _seq, ...rest } = e;
      void _seq;
      await tx.store.add(rest as LogEntry);
    }
    await tx.done;
    await trimStore();
  } catch (e) {
    // Журнал не должен ломать приложение: не смогли записать — только в консоль.
    rawConsole.warn('[log] не удалось записать журнал в IndexedDB', e);
  }
}

/** Вытеснение старых записей, чтобы журнал не рос бесконечно. */
async function trimStore(): Promise<void> {
  try {
    const db = await getDB();
    const count = await db.count('logs');
    if (count <= MAX_STORED) return;
    const excess = count - MAX_STORED;
    const tx = db.transaction('logs', 'readwrite');
    let cur = await tx.store.openCursor();
    let removed = 0;
    while (cur && removed < excess) {
      await cur.delete();
      removed += 1;
      cur = await cur.continue();
    }
    await tx.done;
  } catch {
    // не критично
  }
}

/** Записать событие. Основная точка входа. */
function write(level: LogLevel, scope: string, msg: string, data?: unknown): void {
  if (RANK[level] < RANK[minLevel]) return;
  const entry: LogEntry = {
    ts: Date.now(),
    level,
    scope,
    msg: String(msg),
    session: context.session,
  };
  if (data !== undefined) entry.data = sanitize(data);

  memory.push(entry);
  if (memory.length > MAX_MEMORY) memory.splice(0, memory.length - MAX_MEMORY);
  pendingWrites.push(entry);
  scheduleFlush();

  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      // подписчик не должен ронять логгер
    }
  }

  // Дублируем в консоль — при живой девтулзе так удобнее, чем лезть в базу.
  inside = true;
  try {
    const prefix = `[${scope}]`;
    const args = data !== undefined ? [prefix, msg, data] : [prefix, msg];
    if (level === 'error') rawConsole.error(...args);
    else if (level === 'warn') rawConsole.warn(...args);
    else if (level === 'info') rawConsole.info(...args);
    else rawConsole.debug(...args);
  } finally {
    inside = false;
  }
}

/** Публичный логгер. */
export const log = {
  debug: (scope: string, msg: string, data?: unknown) => write('debug', scope, msg, data),
  info: (scope: string, msg: string, data?: unknown) => write('info', scope, msg, data),
  warn: (scope: string, msg: string, data?: unknown) => write('warn', scope, msg, data),
  error: (scope: string, msg: string, data?: unknown) => write('error', scope, msg, data),
};

/** Текущий контекст запуска (платформа, версия и т.д.). */
export function getLogContext(): LogContext {
  return { ...context };
}

/** Минимальный уровень записи. */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function getLogLevel(): LogLevel {
  return minLevel;
}

/** Подписка на новые записи (для экрана «Логи» в настройках). */
export function onLog(fn: (e: LogEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Последние записи из памяти (без обращения к базе). */
export function recentLogs(): LogEntry[] {
  return [...memory];
}

/**
 * Установить перехватчики и записать шапку сессии.
 * Вызывать как можно раньше при старте приложения; повторный вызов безвреден.
 */
export function initLogging(opts: { appVersion?: string; level?: LogLevel; persist?: boolean } = {}): LogContext {
  if (opts.level) minLevel = opts.level;
  if (opts.persist === false) persistEnabled = false;

  context = {
    session: context.session,
    platform: detectPlatform(),
    appVersion: opts.appVersion ?? 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    screen:
      typeof window !== 'undefined' && window.screen
        ? `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio ?? 1}`
        : '',
    startedAt: Date.now(),
  };

  if (!installed && typeof window !== 'undefined') {
    installed = true;

    window.addEventListener('error', (ev) => {
      // Ошибки загрузки ресурсов приходят сюда же, но без ev.error.
      const target = ev.target as HTMLElement | null;
      if (target && target !== (window as unknown as EventTarget) && 'tagName' in target) {
        write('error', 'app', `не загрузился ресурс <${target.tagName.toLowerCase()}>`, {
          src: (target as HTMLImageElement).src ?? (target as HTMLScriptElement).src,
        });
        return;
      }
      write('error', 'app', `необработанная ошибка: ${ev.message}`, {
        error: ev.error,
        file: ev.filename,
        line: ev.lineno,
        col: ev.colno,
      });
    }, true);

    window.addEventListener('unhandledrejection', (ev) => {
      write('error', 'app', 'необработанный отказ промиса', { reason: ev.reason });
    });

    // Перехват console.error/warn: чужой код (foliate-js, pdf.js, tesseract)
    // пишет туда напрямую, и без перехвата эти сообщения до нас не доходят.
    console.error = (...args: unknown[]) => {
      rawConsole.error(...args);
      if (!inside) write('error', 'console', args.map(brief).join(' '), args.length > 1 ? args : args[0]);
    };
    console.warn = (...args: unknown[]) => {
      rawConsole.warn(...args);
      if (!inside) write('warn', 'console', args.map(brief).join(' '), args.length > 1 ? args : args[0]);
    };

    // Последний шанс дописать хвост журнала перед закрытием.
    window.addEventListener('pagehide', () => {
      void flushToDb();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushToDb();
    });
  }

  write('info', 'app', 'запуск приложения', {
    платформа: context.platform,
    версия: context.appVersion,
    экран: context.screen,
    язык: context.language,
    ua: context.userAgent,
    сессия: context.session,
  });
  return { ...context };
}

/** Короткое представление аргумента консоли для строки сообщения. */
function brief(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    const s = JSON.stringify(sanitize(v));
    return s && s.length > 200 ? `${s.slice(0, 200)}…` : (s ?? String(v));
  } catch {
    return String(v);
  }
}

/** Все записи из базы (новые в конце). */
export async function allLogs(limit = MAX_STORED): Promise<LogEntry[]> {
  await flushToDb();
  try {
    const db = await getDB();
    const all = await db.getAll('logs');
    return all.slice(-limit);
  } catch {
    return recentLogs();
  }
}

/** Очистить журнал (память + база). */
export async function clearLogs(): Promise<void> {
  memory.length = 0;
  pendingWrites = [];
  try {
    const db = await getDB();
    await db.clear('logs');
  } catch {
    // не критично
  }
}

/** Журнал одним NDJSON-текстом: шапка контекста + по записи на строку. */
export async function exportLogsText(): Promise<string> {
  const entries = await allLogs();
  const head = JSON.stringify({ тип: 'контекст', ...context, экспорт: new Date().toISOString() });
  return [head, ...entries.map((e) => JSON.stringify(e))].join('\n');
}

/**
 * Порция записей для отправки на сервер: всё, что новее `afterSeq`.
 * Возвращает и записи, и новый маркер — вызывающий сохраняет его у себя
 * и передаёт в следующий раз (так одни и те же строки не улетают дважды).
 */
export async function takeForUpload(
  afterSeq: number,
  limit = 500,
): Promise<{ entries: LogEntry[]; lastSeq: number }> {
  await flushToDb();
  try {
    const db = await getDB();
    const range = afterSeq > 0 ? IDBKeyRange.lowerBound(afterSeq, true) : undefined;
    const keys = await db.getAllKeys('logs', range, limit);
    const values = await db.getAll('logs', range, limit);
    const entries = values.map((v, i) => ({ ...v, seq: keys[i] as number }));
    const lastSeq = entries.length ? (keys[entries.length - 1] as number) : afterSeq;
    return { entries, lastSeq };
  } catch {
    return { entries: [], lastSeq: afterSeq };
  }
}
