/**
 * Загрузка книг на сервер (ТЗ Часть 6, п.6.5). Доступно учителю (свои классы/
 * предметы), старшему пользователю и администратору. Сервер проверяет права.
 */
import { writable, get } from 'svelte/store';
import type { Role } from '@reader/network';
import { getBookFile, updateBook, type BookMeta } from '@reader/core';
import { authedClient, session } from './auth';
import { openCatalog, refreshAvailable } from './store';
import { refreshLibrary } from '../stores';

export const uploading = writable(false);
export const uploadError = writable('');
export const uploadMsg = writable('');

/** Может ли роль добавлять книги. */
export function canUpload(role: Role | undefined): boolean {
  return role === 'admin' || role === 'power' || role === 'teacher';
}

export interface UploadMeta {
  title?: string;
  classes?: string[];
  subjects?: string[];
  categories?: string[];
  /** «Доступна всем» — книгу видят все активные пользователи (ТЗ 6.5). */
  public?: boolean;
}

/**
 * Опубликовать локальную книгу на сервер с её текущими тегами (класс/предмет/
 * категория). Если книга уже на сервере (есть serverId) — только обновляем теги
 * (без повторной загрузки файла, без дублей). Иначе — грузим файл и запоминаем
 * serverId. Так «Добавить книгу» и правка тегов на главной доезжают до сервера,
 * и ученики класса сразу видят книгу. true — успех.
 */
/**
 * Подпись тегов книги (классы/предметы/категории, отсортированы). Совпадение с
 * `book.serverSynced` означает «опубликованное на сервере = текущее локальное».
 */
export function tagsSignature(book: BookMeta): string {
  const norm = (a?: string[]) => [...(a ?? [])].sort();
  return JSON.stringify({
    c: norm(book.classes),
    s: norm(book.subjects),
    k: norm(book.categories),
  });
}

export async function publishToServer(book: BookMeta): Promise<boolean> {
  const c = authedClient();
  if (!c || !canUpload(get(session)?.user.role)) return false;
  uploading.set(true);
  uploadError.set('');
  uploadMsg.set('');
  try {
    const tags = {
      classes: book.classes ?? [],
      subjects: book.subjects ?? [],
      categories: book.categories ?? [],
    };
    const sig = tagsSignature(book);
    if (book.serverId) {
      await c.updateBookTags(book.serverId, tags);
      await updateBook(book.id, { serverSynced: sig });
    } else {
      const file = await getBookFile(book.id);
      const res = await c.uploadBook(file, { fileName: file.name, title: book.title, ...tags });
      await updateBook(book.id, { serverId: res.id, serverSynced: sig });
    }
    await refreshLibrary();
    uploadMsg.set(`«${book.title}» опубликована на сервере.`);
    void refreshAvailable();
    return true;
  } catch (e) {
    uploadError.set(e instanceof Error ? e.message : 'Не удалось опубликовать книгу');
    return false;
  } finally {
    uploading.set(false);
  }
}

/** Загрузить файл книги на сервер. true — успех. */
export async function uploadBook(file: File, meta: UploadMeta): Promise<boolean> {
  const c = authedClient();
  if (!c || !canUpload(get(session)?.user.role)) return false;
  uploading.set(true);
  uploadError.set('');
  uploadMsg.set('');
  try {
    await c.uploadBook(file, { fileName: file.name, ...meta });
    uploadMsg.set(`Книга «${meta.title || file.name}» добавлена.`);
    await openCatalog(); // обновить каталог
    return true;
  } catch (e) {
    uploadError.set(e instanceof Error ? e.message : 'Не удалось загрузить книгу');
    return false;
  } finally {
    uploading.set(false);
  }
}
