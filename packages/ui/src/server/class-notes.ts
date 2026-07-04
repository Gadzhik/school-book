/**
 * Заметки учителя, видимые классу: учитель публикует выделение с заметкой,
 * ученики его классов видят подсветку в своей копии книги (по serverId).
 * Хранение — на сервере (таблица class_notes), клиент тянет при открытии книги.
 */
import { get } from 'svelte/store';
import type { ClassNote, Role } from '@reader/network';
import { listClasses } from '@reader/core';
import { authedClient, session } from './auth';

/** Цвет подсветки заметок учителя (отличается от жёлтых своих выделений). */
export const CLASS_NOTE_COLOR = '#7cb0ff';

/** Может ли роль публиковать заметки классу. */
export function canShareToClass(role: Role | undefined): boolean {
  return role === 'admin' || role === 'power' || role === 'teacher';
}

/** Заметки по книге (для текущего пользователя). Ошибки — тихо, пустой список. */
export async function fetchClassNotes(serverBookId: string): Promise<ClassNote[]> {
  const c = authedClient();
  if (!c) return [];
  try {
    return await c.classNotes(serverBookId);
  } catch {
    return [];
  }
}

/**
 * Опубликовать выделение классам текущего пользователя. Учитель — свои классы;
 * у admin/power классов нет — публикуем всем классам из справочника.
 * Возвращает текст ошибки или null при успехе.
 */
export async function shareToClass(
  serverBookId: string,
  data: { cfi: string; text: string; note?: string },
): Promise<string | null> {
  const c = authedClient();
  const s = get(session);
  if (!c || !s) return 'Нет подключения к серверу';
  let classIds = s.user.classes;
  if (classIds.length === 0) {
    classIds = (await listClasses()).map((x) => x.id);
  }
  try {
    await c.publishClassNote({
      bookId: serverBookId,
      classIds,
      cfi: data.cfi,
      text: data.text,
      note: data.note,
      color: CLASS_NOTE_COLOR,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Не удалось опубликовать заметку';
  }
}

/** Убрать заметку (у всех классов публикации). */
export async function removeClassNote(id: string): Promise<boolean> {
  const c = authedClient();
  if (!c) return false;
  try {
    await c.deleteClassNote(id);
    return true;
  } catch {
    return false;
  }
}
