/**
 * Хранение файлов книг в OPFS (Origin Private File System).
 * OPFS быстрее и надёжнее для крупных бинарников, чем blob в IndexedDB.
 * Если OPFS недоступен (старый браузер / iOS-ограничения) — вызывающий код
 * переключается на хранение blob прямо в IndexedDB (см. library.ts).
 */

/** Поддерживается ли OPFS в текущем окружении. */
export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

/** Получить (создав при необходимости) каталог /books в OPFS. */
async function booksDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('books', { create: true });
}

/** Сохранить файл книги в OPFS. Возвращает имя файла внутри /books. */
export async function saveBlobToOpfs(id: string, ext: string, data: Blob): Promise<string> {
  const dir = await booksDir();
  const name = ext ? `${id}.${ext}` : id;
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
  return name;
}

/** Прочитать файл книги из OPFS как File. */
export async function readBlobFromOpfs(name: string): Promise<File> {
  const dir = await booksDir();
  const handle = await dir.getFileHandle(name);
  return handle.getFile();
}

/** Удалить файл книги из OPFS (молча игнорирует отсутствие). */
export async function deleteBlobFromOpfs(name: string): Promise<void> {
  try {
    const dir = await booksDir();
    await dir.removeEntry(name);
  } catch {
    /* файла нет — ок */
  }
}
