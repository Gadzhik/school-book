/**
 * Администрирование (ТЗ Часть 6, E8+E9): журнал действий и резервная копия.
 * Журнал — admin/power; скачивание бэкапа — только admin.
 */
import { writable, get } from 'svelte/store';
import type { Role, AuditEntry } from '@reader/network';
import { authedClient, session } from './auth';

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
    adminError.set(e instanceof Error ? e.message : 'Не удалось загрузить журнал');
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `chitalka-backup-${date}.db`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    adminError.set(e instanceof Error ? e.message : 'Не удалось скачать копию');
  } finally {
    adminBusy.set(false);
  }
}
