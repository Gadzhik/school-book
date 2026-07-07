/**
 * Администрирование (ТЗ Часть 6, E8+E9): журнал действий и резервная копия.
 * Журнал — admin/power; скачивание бэкапа — только admin.
 */
import { writable, get } from 'svelte/store';
import type {
  Role,
  AuditEntry,
  BackupSettings,
  BackupSettingsInfo,
  BackupFile,
  LogLevel,
  LogLevelInfo,
} from '@reader/network';
import { authedClient, session } from './auth';
import { tr } from '../i18n';

export const auditEntries = writable<AuditEntry[]>([]);
export const adminBusy = writable(false);
export const adminError = writable('');

/** Видит ли роль журнал действий. */
export function canAudit(role: Role | undefined): boolean {
  return role === 'admin' || role === 'power';
}
/** Может ли роль скачивать резервную копию. */
export function canBackup(role: Role | undefined): boolean {
  return role === 'admin';
}

/** Загрузить журнал действий. */
export async function loadAudit(): Promise<void> {
  const c = authedClient();
  if (!c || !canAudit(get(session)?.user.role)) return;
  adminBusy.set(true);
  adminError.set('');
  try {
    auditEntries.set(await c.getAudit());
  } catch (e) {
    adminError.set(e instanceof Error ? e.message : tr('Не удалось загрузить журнал'));
  } finally {
    adminBusy.set(false);
  }
}

/** Скачать резервную копию БД (файл в браузере). */
export async function downloadBackup(): Promise<void> {
  const c = authedClient();
  if (!c || !canBackup(get(session)?.user.role)) return;
  adminBusy.set(true);
  adminError.set('');
  try {
    const blob = await c.backup();
    saveBlob(blob, `chitalka-backup-${new Date().toISOString().slice(0, 10)}.db`);
  } catch (e) {
    adminError.set(e instanceof Error ? e.message : tr('Не удалось скачать копию'));
  } finally {
    adminBusy.set(false);
  }
}

// --- Резервные копии: настройки автобэкапа, ручной запуск, восстановление ---

export const backupInfo = writable<BackupSettingsInfo | null>(null);
export const backupFiles = writable<BackupFile[]>([]);
export const backupBusy = writable(false);
export const backupError = writable('');
/** Уведомление об успехе (имя сделанной копии, результат восстановления…). */
export const backupNotice = writable('');

/** Сохранить Blob как файл в браузере. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function withBackupBusy(fn: () => Promise<void>): Promise<void> {
  const role = get(session)?.user.role;
  if (!canBackup(role)) return;
  backupBusy.set(true);
  backupError.set('');
  backupNotice.set('');
  try {
    await fn();
  } catch (e) {
    backupError.set(e instanceof Error ? e.message : tr('Операция не удалась'));
  } finally {
    backupBusy.set(false);
  }
}

/** Загрузить настройки автобэкапа и список копий на сервере. */
export async function loadBackupInfo(): Promise<void> {
  await withBackupBusy(async () => {
    const c = authedClient();
    if (!c) return;
    backupInfo.set(await c.getBackupSettings());
    backupFiles.set(await c.listBackups());
  });
}

/** Сохранить настройки автобэкапа (расписание применяется сразу). */
export async function saveBackupSettings(s: BackupSettings): Promise<void> {
  await withBackupBusy(async () => {
    const c = authedClient();
    if (!c) return;
    await c.putBackupSettings(s);
    backupInfo.set(await c.getBackupSettings());
    backupNotice.set(tr('Настройки сохранены'));
  });
}

/** Сделать копию на сервере прямо сейчас (в папку из настроек). */
export async function backupNow(): Promise<void> {
  await withBackupBusy(async () => {
    const c = authedClient();
    if (!c) return;
    const r = await c.runBackupNow();
    backupFiles.set(await c.listBackups());
    backupInfo.set(await c.getBackupSettings());
    backupNotice.set(tr('Копия создана: {0}', r.file));
  });
}

/** Скачать полный архив (БД + книги) файлом в браузере. */
export async function downloadFullBackup(): Promise<void> {
  await withBackupBusy(async () => {
    const c = authedClient();
    if (!c) return;
    const blob = await c.backupFull();
    saveBlob(blob, `chitalka-full-backup-${new Date().toISOString().slice(0, 10)}.zip`);
  });
}

// --- Уровень логирования сервера (админ) ---

export const logLevelInfo = writable<LogLevelInfo | null>(null);
export const logLevelBusy = writable(false);
export const logLevelError = writable('');

/** Загрузить текущий уровень логирования сервера. */
export async function loadLogLevel(): Promise<void> {
  const c = authedClient();
  if (!c || !canBackup(get(session)?.user.role)) return;
  logLevelBusy.set(true);
  logLevelError.set('');
  try {
    logLevelInfo.set(await c.getLogLevel());
  } catch (e) {
    logLevelError.set(e instanceof Error ? e.message : tr('Операция не удалась'));
  } finally {
    logLevelBusy.set(false);
  }
}

/** Сменить уровень логирования (применяется на сервере сразу). */
export async function changeLogLevel(level: LogLevel): Promise<void> {
  const c = authedClient();
  if (!c || !canBackup(get(session)?.user.role)) return;
  logLevelBusy.set(true);
  logLevelError.set('');
  try {
    await c.setLogLevel(level);
    logLevelInfo.set(await c.getLogLevel());
  } catch (e) {
    logLevelError.set(e instanceof Error ? e.message : tr('Операция не удалась'));
  } finally {
    logLevelBusy.set(false);
  }
}

/** Восстановить БД сервера из выбранного файла .db. */
export async function restoreFromFile(file: File): Promise<void> {
  await withBackupBusy(async () => {
    const c = authedClient();
    if (!c) return;
    const r = await c.restore(file);
    backupNotice.set(r.message || tr('База восстановлена'));
  });
}
