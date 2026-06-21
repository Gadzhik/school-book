/**
 * Загрузка книг на сервер (ТЗ Часть 6, п.6.5). Доступно учителю (свои классы/
 * предметы), старшему пользователю и администратору. Сервер проверяет права.
 */
import { writable, get } from 'svelte/store';
import type { Role } from '@reader/network';
import { authedClient, session } from './auth';
import { openCatalog } from './store';

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
