/**
 * Клиент библиотечного сервера (ТЗ 4.4): OPDS-каталог, скачивание книг
 * (с Range), REST-синхронизация прогресса/«Моих слов».
 * Работает в браузере/WebView. Сетевые ошибки пробрасывает — вызывающий
 * решает (офлайн-первый клиент: нет сервера → работаем локально).
 */
import { parseOpds, resolveHref, type OpdsFeed } from './opds';
import type {
  ServerInfo,
  ServerStatus,
  DeviceProgress,
  WordSyncItem,
  RegisterPayload,
  LoginPayload,
  AuthResult,
  UserAccount,
  Role,
  Assignment,
  AssignmentForStudent,
  AssignmentInput,
  AssignmentReportRow,
  AuditEntry,
  BookmarkSyncItem,
  HighlightSyncItem,
} from './types';

export interface ClientOptions {
  /** Токен/PIN пэйринга (ТЗ 4.5). */
  token?: string;
  /** Таймаут запросов, мс. */
  timeoutMs?: number;
}

export class LibraryServerClient {
  readonly baseUrl: string;
  #token?: string;
  #timeoutMs: number;

  constructor(server: ServerInfo, opts: ClientOptions = {}) {
    this.baseUrl = server.baseUrl.replace(/\/$/, '');
    this.#token = opts.token;
    this.#timeoutMs = opts.timeoutMs ?? 10000;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.#token ? { Authorization: `Bearer ${this.#token}`, ...extra } : extra;
  }

  /** Обновить токен авторизации (после входа/регистрации — это JWT). */
  setToken(token?: string): void {
    this.#token = token;
  }

  /**
   * POST с JSON-телом; при ошибке поднимает сообщение из тела ответа сервера
   * (например «Логин уже занят»). Для регистрации/входа.
   */
  async #postJson<T>(path: string, body: unknown): Promise<T> {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.#timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: this.#headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = (await res.text().catch(() => '')).trim();
        throw new Error(msg || `Сервер ответил ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async #fetch(path: string, init: RequestInit = {}, timeoutMs = this.#timeoutMs): Promise<Response> {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: this.#headers(init.headers as Record<string, string>),
      });
      if (!res.ok) throw new Error(`Сервер ответил ${res.status} на ${path}`);
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  /** Статус сервера (для пинга и отображения имени). */
  async status(): Promise<ServerStatus> {
    const res = await this.#fetch('/status');
    const data = (await res.json()) as Partial<ServerStatus>;
    return { ok: true, ...data };
  }

  /** Доступен ли сервер (быстрый пинг без исключения). */
  async ping(): Promise<boolean> {
    try {
      await this.status();
      return true;
    } catch {
      return false;
    }
  }

  /** Получить и разобрать OPDS-каталог (по умолчанию корневой /opds). */
  async catalog(path = '/opds'): Promise<{ feed: OpdsFeed; url: string }> {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    const res = await this.#fetch(url);
    return { feed: parseOpds(await res.text()), url };
  }

  /** Абсолютный URL ссылки внутри фида (обложка/скачивание). */
  absolute(href: string, feedUrl: string): string {
    return resolveHref(href, feedUrl);
  }

  /**
   * Скачать книгу по ссылке acquisition. Сервер обязан поддерживать Range
   * (ТЗ 4.7) — здесь берём файл целиком; докачку добавит загрузчик отдельно.
   */
  async download(href: string): Promise<Blob> {
    const res = await this.#fetch(href);
    return res.blob();
  }

  // --- Аккаунты (ТЗ Часть 6) ---

  /** Регистрация. Возвращает JWT + профиль; токен клиента обновляется. */
  async register(payload: RegisterPayload): Promise<AuthResult> {
    const res = await this.#postJson<AuthResult>('/api/register', payload);
    this.#token = res.token;
    return res;
  }

  /** Вход по логину/паролю. Обновляет токен клиента. */
  async login(payload: LoginPayload): Promise<AuthResult> {
    const res = await this.#postJson<AuthResult>('/api/login', payload);
    this.#token = res.token;
    return res;
  }

  /** Профиль текущего пользователя (по установленному JWT). */
  async me(): Promise<UserAccount> {
    const res = await this.#fetch('/api/me');
    return (await res.json()) as UserAccount;
  }

  /** Пользователи, доступные для управления/одобрения (по роли — решает сервер). */
  async listUsers(): Promise<UserAccount[]> {
    const res = await this.#fetch('/api/users');
    return (await res.json()) as UserAccount[];
  }

  /** Одобрить пользователя (статус → active). */
  async approveUser(id: string): Promise<void> {
    await this.#fetch(`/api/users/${encodeURIComponent(id)}/approve`, { method: 'POST' });
  }

  /** Отклонить/заблокировать пользователя (статус → blocked). */
  async rejectUser(id: string): Promise<void> {
    await this.#fetch(`/api/users/${encodeURIComponent(id)}/reject`, { method: 'POST' });
  }

  /**
   * Создать пользователя (админ — любая роль; power — teacher/student).
   * Создаётся сразу активным (без одобрения). Права проверяет сервер.
   */
  async createUser(input: {
    fullName: string;
    login: string;
    password: string;
    role: Role;
    classes?: string[];
    subjects?: string[];
  }): Promise<UserAccount> {
    return this.#postJson<UserAccount>('/api/users', input);
  }

  /** Сменить роль пользователя (админ/power; нельзя свою). Сервер шлёт 204. */
  async setUserRole(id: string, role: Role): Promise<void> {
    await this.#fetch(`/api/users/${encodeURIComponent(id)}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
  }

  /** Удалить пользователя (админ/power по правам; нельзя себя). */
  async deleteUser(id: string): Promise<void> {
    await this.#fetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Сменить свой пароль (нужен текущий). Сервер шлёт 204. */
  async changeMyPassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.#fetch('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  }

  /** Сбросить пароль другого пользователя (админ/power; нельзя себя). 204. */
  async resetUserPassword(id: string, newPassword: string): Promise<void> {
    await this.#fetch(`/api/users/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
  }

  /**
   * Загрузить книгу на сервер (ТЗ 6.5). Права/привязку к классам проверяет
   * сервер (учитель — только свои классы/предметы). Возвращает id книги.
   */
  async uploadBook(
    file: Blob,
    meta: { fileName?: string; title?: string; classes?: string[]; subjects?: string[]; categories?: string[] } = {},
  ): Promise<{ id: string }> {
    const fd = new FormData();
    fd.append('file', file, meta.fileName || (file as File).name || 'book');
    if (meta.title) fd.append('title', meta.title);
    if (meta.classes?.length) fd.append('classes', meta.classes.join(','));
    if (meta.subjects?.length) fd.append('subjects', meta.subjects.join(','));
    if (meta.categories?.length) fd.append('categories', meta.categories.join(','));
    // Content-Type не задаём — браузер сам выставит boundary для multipart.
    // Длинный таймаут: большие книги (PDF на десятки МБ) грузятся по сети
    // дольше обычного запроса — иначе AbortController рвёт аплоад (NetworkError).
    const res = await this.#fetch('/books', { method: 'POST', body: fd }, 10 * 60_000);
    return (await res.json()) as { id: string };
  }

  // --- Задания (ТЗ Часть 6, п.6.5) ---

  /** Задания: ученику — свои с личным статусом; учителю/админу — по правам. */
  async listAssignments(): Promise<(Assignment | AssignmentForStudent)[]> {
    const res = await this.#fetch('/api/assignments');
    return (await res.json()) as (Assignment | AssignmentForStudent)[];
  }

  /** Создать задание (учитель — для своих классов). */
  async createAssignment(input: AssignmentInput): Promise<Assignment> {
    return this.#postJson<Assignment>('/api/assignments', input);
  }

  /** Удалить задание (создатель/админ/power). */
  async deleteAssignment(id: string): Promise<void> {
    await this.#fetch(`/api/assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Отметить выполнение задания учеником. */
  async setAssignmentProgress(id: string, status: 'reading' | 'done', fraction = 0): Promise<void> {
    await this.#fetch(`/api/assignments/${encodeURIComponent(id)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, fraction }),
    });
  }

  /** Отчёт по заданию (ученики класса + статусы). */
  async assignmentReport(id: string): Promise<AssignmentReportRow[]> {
    const res = await this.#fetch(`/api/assignments/${encodeURIComponent(id)}/report`);
    return (await res.json()) as AssignmentReportRow[];
  }

  // --- Аудит и бэкап (ТЗ Часть 6, E8+E9) ---

  /** Журнал действий (админ/power). */
  async getAudit(): Promise<AuditEntry[]> {
    const res = await this.#fetch('/api/audit');
    return (await res.json()) as AuditEntry[];
  }

  /** Скачать резервную копию БД (админ) как Blob. */
  async backup(): Promise<Blob> {
    const res = await this.#fetch('/api/backup');
    return res.blob();
  }

  /** Прогресс книги на сервере (последняя версия). */
  async getProgress(bookId: string): Promise<DeviceProgress | undefined> {
    try {
      const res = await this.#fetch(`/api/progress/${encodeURIComponent(bookId)}`);
      return (await res.json()) as DeviceProgress;
    } catch {
      return undefined;
    }
  }

  /** Отправить прогресс книги (LWW решает сервер по updatedAt). */
  async putProgress(p: DeviceProgress): Promise<void> {
    await this.#fetch(`/api/progress/${encodeURIComponent(p.bookId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
  }

  // --- Закладки/выделения (per-user, ТЗ Часть 6, п.6.3) ---

  /** Закладки пользователя, изменённые после since. */
  async pullBookmarks(since = 0): Promise<BookmarkSyncItem[]> {
    const res = await this.#fetch(`/api/bookmarks?since=${since}`);
    return (await res.json()) as BookmarkSyncItem[];
  }

  /** Отправить локальные изменения закладок. */
  async pushBookmarks(items: BookmarkSyncItem[]): Promise<void> {
    await this.#fetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
  }

  /** Выделения пользователя, изменённые после since. */
  async pullHighlights(since = 0): Promise<HighlightSyncItem[]> {
    const res = await this.#fetch(`/api/highlights?since=${since}`);
    return (await res.json()) as HighlightSyncItem[];
  }

  /** Отправить локальные изменения выделений. */
  async pushHighlights(items: HighlightSyncItem[]): Promise<void> {
    await this.#fetch('/api/highlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
  }

  /** Забрать слова с сервера, изменённые после метки since (epoch ms). */
  async pullWords(since = 0): Promise<WordSyncItem[]> {
    const res = await this.#fetch(`/api/words?since=${since}`);
    return (await res.json()) as WordSyncItem[];
  }

  /** Отправить локальные изменения слов. */
  async pushWords(items: WordSyncItem[]): Promise<void> {
    await this.#fetch('/api/words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
  }
}
