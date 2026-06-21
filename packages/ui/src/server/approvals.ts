/**
 * Одобрение регистраций (ТЗ Часть 6, п.6.2/6.5). Учитель одобряет учеников
 * своих классов; админ/power — учителей и учеников. Сервер проверяет права;
 * клиент показывает только доступные заявки.
 */
import { writable, get } from 'svelte/store';
import type { Role, UserAccount } from '@reader/network';
import { authedClient, session } from './auth';

/** Пользователи, доступные текущему для управления (с сервера). */
export const manageableUsers = writable<UserAccount[]>([]);
/** Идёт загрузка/действие. */
export const approvalsBusy = writable(false);
/** Ошибка (текст для UI). */
export const approvalsError = writable('');

/** Может ли роль управлять заявками (показывать раздел одобрения). */
export function canManage(role: Role | undefined): boolean {
  return role === 'admin' || role === 'power' || role === 'teacher';
}

/** Загрузить список пользователей для одобрения. */
export async function loadApprovals(): Promise<void> {
  const c = authedClient();
  if (!c || !canManage(get(session)?.user.role)) {
    manageableUsers.set([]);
    return;
  }
  approvalsBusy.set(true);
  approvalsError.set('');
  try {
    manageableUsers.set(await c.listUsers());
  } catch (e) {
    approvalsError.set(e instanceof Error ? e.message : 'Не удалось загрузить заявки');
  } finally {
    approvalsBusy.set(false);
  }
}

/** Одобрить пользователя и обновить список. */
export async function approve(id: string): Promise<void> {
  await act((c) => c.approveUser(id));
}

/** Отклонить/заблокировать пользователя и обновить список. */
export async function reject(id: string): Promise<void> {
  await act((c) => c.rejectUser(id));
}

async function act(fn: (c: NonNullable<ReturnType<typeof authedClient>>) => Promise<void>): Promise<void> {
  const c = authedClient();
  if (!c) return;
  approvalsBusy.set(true);
  approvalsError.set('');
  try {
    await fn(c);
    manageableUsers.set(await c.listUsers());
  } catch (e) {
    approvalsError.set(e instanceof Error ? e.message : 'Действие не выполнено');
  } finally {
    approvalsBusy.set(false);
  }
}
