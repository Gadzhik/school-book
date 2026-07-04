/**
 * Загрузка книг на сервер (ТЗ Часть 6, п.6.5). Доступно учителю (свои классы/
 * предметы), старшему пользователю и администратору. Сервер проверяет права.
 */
import { writable, get } from 'svelte/store';
import { HttpError, type Role } from '@reader/network';
import { getBookFile, updateBook, type BookMeta } from '@reader/core';
import { authedClient, session } from './auth';
import { openCatalog, refreshAvailable, refreshStatus } from './store';
import { refreshLibrary } from '../stores';
import { tr } from '../i18n';

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
    let serverId = book.serverId;
    if (serverId) {
      try {
        await c.updateBookTags(serverId, tags);
        await updateBook(book.id, { serverSynced: sig });
      } catch (e) {
        // 404 — метка устарела (книгу удалили с сервера): публикуем заново.
        if (!(e instanceof HttpError && e.status === 404)) throw e;
        serverId = undefined;
      }
    }
    if (!serverId) {
      const file = await getBookFile(book.id);
      const res = await c.uploadBook(file, { fileName: file.name, title: book.title, ...tags });
      await updateBook(book.id, { serverId: res.id, serverSynced: sig });
    }
    await refreshLibrary();
    uploadMsg.set(tr('«{0}» опубликована на сервере.', book.title));
    void refreshAvailable();
    void refreshStatus();
    return true;
  } catch (e) {
    uploadError.set(e instanceof Error ? e.message : tr('Не удалось опубликовать книгу'));
    return false;
  } finally {
    uploading.set(false);
  }
}

/**
 * Снять книгу с публикации: удалить с сервера (файл + запись каталога) и
 * забыть serverId локально. Книга остаётся в локальной библиотеке.
 * Права (учитель — только свои) проверяет сервер. true — успех.
 */
export async function unpublishFromServer(book: BookMeta): Promise<boolean> {
  const c = authedClient();
  if (!c || !book.serverId || !canUpload(get(session)?.user.role)) return false;
  uploading.set(true);
  uploadError.set('');
  uploadMsg.set('');
  try {
    try {
      await c.deleteBook(book.serverId);
    } catch (e) {
      // 404 — книги на сервере уже нет (удалена там/устаревшая метка).
      // Локальную метку всё равно снимаем, иначе она зависает навсегда.
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
    await updateBook(book.id, { serverId: undefined, serverSynced: undefined });
    await refreshLibrary();
    uploadMsg.set(tr('«{0}» снята с публикации.', book.title));
    void refreshAvailable();
    void refreshStatus();
    return true;
  } catch (e) {
    uploadError.set(e instanceof Error ? e.message : tr('Не удалось снять с публикации'));
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
    uploadMsg.set(tr('Книга «{0}» добавлена.', meta.title || file.name));
    await openCatalog(); // обновить каталог
    void refreshStatus(); // и счётчик «книг: N»
    return true;
  } catch (e) {
    uploadError.set(e instanceof Error ? e.message : tr('Не удалось загрузить книгу'));
    return false;
  } finally {
    uploading.set(false);
  }
}
