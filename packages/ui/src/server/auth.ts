/**
 * Учётная запись и сессия пользователя (ТЗ Часть 6, п.6.2).
 * Регистрация/вход через библиотечный сервер, JWT-сессия с офлайн-кэшем:
 * после первого онлайн-входа профиль и токен лежат в localStorage, поэтому
 * вход доступен и без сети (новое одобрение/смена роли требуют сервера).
 */
import { writable, get } from 'svelte/store';
import {
  LibraryServerClient,
  type UserAccount,
  type RegisterPayload,
  type LoginPayload,
} from '@reader/network';
import { connection, authToken } from './store';

/** Сессия: к какому серверу относится, JWT и профиль. */
interface Session {
  baseUrl: string;
  token: string;
  user: UserAccount;
}

const SESSION_KEY = 'reader:session';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* нет localStorage — ок */
  }
}

/** Текущая сессия (null — не вошёл). Загружается из кэша → офлайн-вход. */
export const session = writable<Session | null>(loadSession());
// Сразу прокидываем кэшированный JWT в store запросов (каталог фильтруется по
// пользователю с первого запроса, ещё до refreshMe).
authToken.set(loadSession()?.token);
/** Идёт регистрация/вход. */
export const authBusy = writable(false);
/** Ошибка авторизации (текст для UI). */
export const authError = writable('');

function setSession(s: Session | null): void {
  session.set(s);
  saveSession(s);
  authToken.set(s?.token); // запросы каталога/скачивания идут с JWT сессии
}

/** Клиент для авторизации к текущему подключённому серверу. */
function authClient(token?: string): LibraryServerClient {
  const conn = get(connection);
  if (!conn) throw new Error('Сначала подключитесь к серверу');
  return new LibraryServerClient({ baseUrl: conn.baseUrl, name: conn.name }, { token });
}

/** JWT-токен текущей сессии (для авторизованных запросов). */
export function sessionToken(): string | undefined {
  return get(session)?.token;
}

/** Клиент с JWT текущей сессии (для авторизованных запросов). null — нет сессии. */
export function authedClient(): LibraryServerClient | null {
  const conn = get(connection);
  const s = get(session);
  if (!conn || !s) return null;
  return new LibraryServerClient({ baseUrl: conn.baseUrl, name: conn.name }, { token: s.token });
}

/** Регистрация (учитель/ученик). При успехе создаёт сессию. */
export async function register(payload: RegisterPayload): Promise<boolean> {
  authBusy.set(true);
  authError.set('');
  try {
    const conn = get(connection);
    if (!conn) throw new Error('Сначала подключитесь к серверу');
    const res = await authClient().register(payload);
    setSession({ baseUrl: conn.baseUrl, token: res.token, user: res.user });
    return true;
  } catch (e) {
    authError.set(e instanceof Error ? e.message : 'Не удалось зарегистрироваться');
    return false;
  } finally {
    authBusy.set(false);
  }
}

/** Вход по логину/паролю. При успехе создаёт сессию. */
export async function login(payload: LoginPayload): Promise<boolean> {
  authBusy.set(true);
  authError.set('');
  try {
    const conn = get(connection);
    if (!conn) throw new Error('Сначала подключитесь к серверу');
    const res = await authClient().login(payload);
    setSession({ baseUrl: conn.baseUrl, token: res.token, user: res.user });
    return true;
  } catch (e) {
    authError.set(e instanceof Error ? e.message : 'Не удалось войти');
    return false;
  } finally {
    authBusy.set(false);
  }
}

/** Выйти (забыть сессию). */
export function logout(): void {
  setSession(null);
  authError.set('');
}

/**
 * Обновить профиль с сервера (например статус «ожидает» → «активен»).
 * Офлайн/ошибка — тихо оставляем кэшированный профиль.
 */
export async function refreshMe(): Promise<void> {
  const s = get(session);
  if (!s) return;
  try {
    const user = await authClient(s.token).me();
    setSession({ ...s, user });
  } catch (e) {
    // 401 — токен протух/невалиден (напр. сменился секрет сервера после сброса
    // БД): выходим, чтобы показать экран входа. Прочее = офлайн → оставляем кэш.
    if (e instanceof Error && /\b401\b/.test(e.message)) {
      logout();
    }
  }
}
