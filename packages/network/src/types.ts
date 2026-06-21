/**
 * Общие типы клиент-серверного режима (ТЗ Часть 4 / Фаза 5).
 * Используются и клиентом, и (в перспективе) сервером.
 */

/** Имя mDNS-сервиса библиотечного сервера (ТЗ 4.3). */
export const SERVICE_TYPE = '_chitalka._tcp.local';

/** Порт сервера по умолчанию (диапазон ТЗ 4.6: 9700–9899). */
export const DEFAULT_PORT = 9700;

/** Описание найденного/введённого сервера. */
export interface ServerInfo {
  /** Базовый URL, напр. 'http://192.168.1.10:9700' (без слэша в конце). */
  baseUrl: string;
  /** Человекочитаемое имя (из mDNS/статуса), если известно. */
  name?: string;
  /** Версия сервера. */
  version?: string;
}

/** Данные пэйринга: адрес + токен доступа (ТЗ 4.5). */
export interface PairingInfo {
  baseUrl: string;
  /** Токен/PIN для авторизации. */
  token?: string;
}

/** Ответ эндпоинта /status сервера. */
export interface ServerStatus {
  name?: string;
  version?: string;
  /** Число книг в каталоге. */
  books?: number;
  ok: boolean;
}

/**
 * Прогресс чтения на устройстве (ТЗ 4.4: метка времени на устройство,
 * разрешение конфликтов last-write-wins).
 */
export interface DeviceProgress {
  bookId: string;
  /** Идентификатор устройства (стабильный per-device). */
  deviceId: string;
  /** Доля прочитанного 0..1. */
  progress: number;
  /** Позиция (CFI/страница) для «продолжить на любом устройстве». */
  locator?: string;
  /** Метка времени последнего изменения (epoch ms). */
  updatedAt: number;
}

// --- Аккаунты и роли (ТЗ Часть 6) ---

/** Роль пользователя (RBAC, ТЗ 6.1). */
export type Role = 'admin' | 'power' | 'teacher' | 'student';

/** Статус учётной записи. */
export type UserStatus = 'pending' | 'active' | 'blocked';

/** Публичный профиль пользователя (зеркало серверного PublicUser, без секретов). */
export interface UserAccount {
  id: string;
  role: Role;
  status: UserStatus;
  fullName: string;
  login: string;
  subjects: string[];
  classes: string[];
  createdAt: number;
}

/** Данные регистрации (ТЗ 6.2). Учитель: subjects+classes; ученик: class. */
export interface RegisterPayload {
  role: 'teacher' | 'student';
  fullName: string;
  login: string;
  password: string;
  subjects?: string[];
  classes?: string[];
  /** Класс ученика (одиночный). */
  class?: string;
}

/** Данные входа. */
export interface LoginPayload {
  login: string;
  password: string;
}

/** Результат регистрации/входа: JWT + профиль. */
export interface AuthResult {
  token: string;
  user: UserAccount;
}

// --- Задания и прогресс класса (ТЗ Часть 6, п.6.5) ---

/** Задание: книга, назначенная классу. */
export interface Assignment {
  id: string;
  bookId: string;
  bookTitle: string;
  classId: string;
  title: string;
  note?: string;
  dueAt?: number;
  createdBy: string;
  createdAt: number;
}

/** Задание с личным статусом ученика. */
export interface AssignmentForStudent extends Assignment {
  /** "not_started" | "reading" | "done". */
  status: string;
  fraction: number;
}

/** Данные создания задания. */
export interface AssignmentInput {
  bookId: string;
  classId: string;
  title?: string;
  note?: string;
  dueAt?: number;
}

/** Запись журнала действий (аудит, ТЗ Часть 6, E8). */
export interface AuditEntry {
  ts: number;
  actor: string;
  action: string;
  detail?: string;
}

/** Строка отчёта по классу. */
export interface AssignmentReportRow {
  userId: string;
  fullName: string;
  /** "not_started" | "reading" | "done". */
  status: string;
  fraction: number;
  updatedAt?: number;
}

/** Элемент синхронизации закладок (per-user, LWW по updatedAt). */
export interface BookmarkSyncItem {
  id: string;
  bookId: string;
  locator: string;
  label?: string;
  excerpt?: string;
  fraction?: number;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Элемент синхронизации выделений (per-user, LWW по updatedAt). */
export interface HighlightSyncItem {
  id: string;
  bookId: string;
  cfi: string;
  text: string;
  note?: string;
  color?: string;
  fraction?: number;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Элемент синхронизации словаря «Мои слова» (LWW по updatedAt). */
export interface WordSyncItem {
  /** Нормализованная форма — ключ слияния. */
  normalized: string;
  word: string;
  definition?: string;
  updatedAt: number;
  /** true — удалено на источнике (тумбстоун для корректного LWW). */
  deleted?: boolean;
}
