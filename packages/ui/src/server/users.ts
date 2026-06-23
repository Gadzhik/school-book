/**
 * Управление пользователями (админ/power): список, создание, смена роли,
 * блокировка/разблокировка, удаление. Права проверяет сервер; здесь — удобный
 * фасад над клиентом + локальный кэш списка для UI.
 */
import { writable, get } from 'svelte/store';
import type { Role, UserAccount } from '@reader/network';
import { authedClient, session } from './auth';

export const usersList = writable<UserAccount[]>([]);
export const usersBusy = writable(false);
export const usersError = writable('');

/** Может ли роль управлять пользователями (создавать/менять роли). */
export function canManageUsers(role: Role | undefined): boolean {
  return role === 'admin' || role === 'power';
}

/** Какие роли текущий пользователь вправе назначать (UI-ограничение; сервер дублирует). */
export function assignableRoles(role: Role | undefined): Role[] {
  if (role === 'admin') return ['admin', 'power', 'teacher', 'student'];
  if (role === 'power') return ['teacher', 'student'];
  return [];
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Загрузить список пользователей (по правам — решает сервер). */
export async function loadUsers(): Promise<void> {
  const c = authedClient();
  if (!c || !canManageUsers(get(session)?.user.role)) return;
  usersBusy.set(true);
  usersError.set('');
  try {
    usersList.set(await c.listUsers());
  } catch (e) {
    usersError.set(msg(e));
  } finally {
    usersBusy.set(false);
  }
}

export interface NewUser {
  fullName: string;
  login: string;
  password: string;
  role: Role;
  classes?: string[];
  subjects?: string[];
}

/** Создать пользователя. true — успех. */
export async function createUser(input: NewUser): Promise<boolean> {
  const c = authedClient();
  if (!c) return false;
  usersBusy.set(true);
  usersError.set('');
  try {
    await c.createUser(input);
    await loadUsers();
    return true;
  } catch (e) {
    usersError.set(msg(e));
    return false;
  } finally {
    usersBusy.set(false);
  }
}

/** Сменить роль пользователя. */
export async function changeRole(id: string, role: Role): Promise<void> {
  const c = authedClient();
  if (!c) return;
  usersBusy.set(true);
  usersError.set('');
  try {
    await c.setUserRole(id, role);
    await loadUsers();
  } catch (e) {
    usersError.set(msg(e));
  } finally {
    usersBusy.set(false);
  }
}

/** Заблокировать (status → blocked) или разблокировать (→ active). */
export async function setBlocked(id: string, blocked: boolean): Promise<void> {
  const c = authedClient();
  if (!c) return;
  usersBusy.set(true);
  usersError.set('');
  try {
    if (blocked) await c.rejectUser(id);
    else await c.approveUser(id);
    await loadUsers();
  } catch (e) {
    usersError.set(msg(e));
  } finally {
    usersBusy.set(false);
  }
}

/** Сменить свой пароль. Возвращает текст ошибки или null при успехе. */
export async function changeMyPassword(oldPw: string, newPw: string): Promise<string | null> {
  const c = authedClient();
  if (!c) return 'Нет подключения к серверу';
  try {
    await c.changeMyPassword(oldPw, newPw);
    return null;
  } catch (e) {
    return msg(e);
  }
}

/** Сбросить пароль другого пользователя (админ/power). Ошибка или null. */
export async function resetPassword(id: string, newPw: string): Promise<string | null> {
  const c = authedClient();
  if (!c) return 'Нет подключения к серверу';
  try {
    await c.resetUserPassword(id, newPw);
    return null;
  } catch (e) {
    return msg(e);
  }
}

/** Удалить пользователя. */
export async function removeUser(id: string): Promise<void> {
  const c = authedClient();
  if (!c) return;
  usersBusy.set(true);
  usersError.set('');
  try {
    await c.deleteUser(id);
    await loadUsers();
  } catch (e) {
    usersError.set(msg(e));
  } finally {
    usersBusy.set(false);
  }
}
