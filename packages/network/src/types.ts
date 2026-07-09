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
  /** LAN-IP, на котором сервер доступен другим устройствам. */
  address?: string;
  /** Порт, который сервер реально занял. */
  port?: number;
}

/**
 * Прогресс чтения на устройстве (ТЗ 4.4: метка времени на устройство,
 * разрешение конфликтов last-write-wins).
 */
export interface DeviceProgress {
  bookId: string;
  /** Идентификатор устройства (стабильный per-device). */
  deviceId: string;
  /**
   * Аккаунт-владелец (ТЗ Часть 6): ставится сервером по JWT, при отправке
   * заполнять не нужно. Отсутствует — legacy-запись клиента без аккаунта.
   */
  userId?: string;
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
  /** Требуется сменить пароль до работы (встроенный админ, сброс админом). */
  mustChangePassword?: boolean;
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

/**
 * Манифест обновлений приложения на сервере (`<updates>/manifest.json`).
 * files: платформа → имя файла в папке обновлений (android/windows/linux).
 */
export interface UpdateInfo {
  version: string;
  notes?: string;
  files?: Record<string, string>;
}

/** Запись журнала действий (аудит, ТЗ Часть 6, E8). */
export interface AuditEntry {
  ts: number;
  actor: string;
  action: string;
  detail?: string;
}

/** Настройки автоматического резервного копирования (админ). */
export interface BackupSettings {
  /** Включён ли автобэкап. */
  enabled: boolean;
  /** Режим расписания: каждые N часов или ежедневно в HH:MM. */
  mode: 'interval' | 'daily';
  /** Период в часах (mode=interval, >=1). */
  everyHours: number;
  /** Время суток «HH:MM» местное (mode=daily). */
  dailyAt: string;
  /** Сколько последних копий хранить. */
  keep: number;
  /** Папка для копий; пусто → <папка БД>/backups на сервере. */
  dir: string;
  /** true — полный архив (БД + книги), false — только БД. */
  includeBooks: boolean;
}

/** Настройки автобэкапа + фактическое состояние на сервере. */
export interface BackupSettingsInfo {
  settings: BackupSettings;
  /** Фактическая папка копий на сервере (после подстановки умолчания). */
  resolvedDir: string;
  /** Время последней успешной копии, мс epoch (null — ещё не было). */
  lastBackupMs: number | null;
}

/** Файл резервной копии на сервере. */
export interface BackupFile {
  name: string;
  size: number;
  modifiedMs: number;
}

/** Уровень логирования сервера (лестница: каждый включает предыдущие). */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

/** Текущий уровень логирования сервера. */
export interface LogLevelInfo {
  level: LogLevel;
  levels: LogLevel[];
  /** true — на сервере задан RUST_LOG, при старте он главнее настройки. */
  envOverride: boolean;
}

/** Строка сводного прогресса класса: ученик × книга. */
export interface ClassProgressRow {
  userId: string;
  fullName: string;
  bookId: string;
  bookTitle: string;
  /** Доля прочитанного 0..1. */
  fraction: number;
  updatedAt: number;
}

/** Заметка учителя, видимая классу. */
export interface ClassNote {
  id: string;
  bookId: string;
  classId: string;
  cfi: string;
  text: string;
  note?: string;
  color?: string;
  createdBy: string;
  authorName: string;
  updatedAt: number;
}

/** Публикация заметки классам. */
export interface ClassNoteInput {
  bookId: string;
  classIds: string[];
  cfi: string;
  text: string;
  note?: string;
  color?: string;
}

/** Вопрос квиза. `correct` присутствует только у учителя/автора. */
export interface QuizQuestion {
  q: string;
  options: string[];
  correct?: number;
}

/** Квиз от учителя. У ученика — без correct, с его результатом. */
export interface Quiz {
  id: string;
  bookId: string;
  bookTitle: string;
  classId: string;
  title: string;
  questions: QuizQuestion[];
  createdBy?: string;
  createdAt?: number;
  myScore?: number | null;
  myTotal?: number | null;
}

/** Данные создания квиза (correct обязателен). */
export interface QuizInput {
  bookId?: string;
  classId: string;
  title: string;
  questions: { q: string; options: string[]; correct: number }[];
}

/** Результат проверки ответов сервером. */
export interface QuizScore {
  score: number;
  total: number;
  /** true — вопрос отвечен верно (для разбора). */
  per_question: boolean[];
}

/** Строка результатов квиза для учителя. */
export interface QuizResultRow {
  userId: string;
  fullName: string;
  score: number;
  total: number;
  updatedAt: number;
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
