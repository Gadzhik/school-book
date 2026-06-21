/**
 * Стор сессии сканера (Фаза 2.5). Держит активную ScanSession и зеркалит
 * её страницы в реактивный стор для UI. Логика — в @reader/book-scanner.
 */
import { writable, get } from 'svelte/store';
import {
  ScanSession,
  saveScannedBook,
  DEFAULT_PROCESS,
  type ScanPage,
  type OutputFormat,
  type ScanBookMeta,
  type ProcessOptions,
  type AssembleOptions,
} from '@reader/book-scanner';
import { getCamera } from '@reader/adapters';
import { refreshLibrary, view } from '../stores';

let session: ScanSession | null = null;

/** Страницы текущей сессии (зеркало session.pages). */
export const pages = writable<ScanPage[]>([]);
/** Идёт обработка/сборка — блокируем повторные действия. */
export const scannerBusy = writable(false);
/** Прогресс сборки: { done, total } либо null. */
export const assembleProgress = writable<{ done: number; total: number } | null>(null);
/** Текст ошибки сканера. */
export const scannerError = writable<string | null>(null);
/** Авто-обрезка листа + коррекция перспективы (Stage B, OpenCV лениво). */
export const autoCrop = writable<boolean>(DEFAULT_PROCESS.autoCrop);

function sync() {
  pages.set(session ? [...session.pages] : []);
}

/** Текущие параметры обработки страницы (с учётом тумблеров UI). */
function processOpts(): ProcessOptions {
  return { ...DEFAULT_PROCESS, autoCrop: get(autoCrop) };
}

/** Поддерживается ли сканер (нужен OPFS). */
export function scannerSupported(): boolean {
  return ScanSession.isSupported();
}

/** Открыть экран сканера с новой сессией. */
export function startScanner(): void {
  session = new ScanSession();
  pages.set([]);
  scannerError.set(null);
  assembleProgress.set(null);
  view.set({ name: 'scanner' });
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (get(scannerBusy)) return undefined;
  scannerBusy.set(true);
  scannerError.set(null);
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    scannerError.set(err instanceof Error ? err.message : 'Ошибка сканера');
    return undefined;
  } finally {
    scannerBusy.set(false);
  }
}

/** Снять страницы камерой (или выбрать несколько изображений). */
export async function capturePages(): Promise<void> {
  await withBusy(async () => {
    if (!session) return;
    const files = await getCamera().capture({ multiple: true, facing: 'environment' });
    const opts = processOpts();
    for (const file of files) {
      await session.addImage(file, opts);
      sync(); // показываем страницы по мере обработки
    }
  });
}

/** Добавить уже выбранные файлы изображений (drag-drop / input). */
export async function importFiles(files: File[]): Promise<void> {
  await withBusy(async () => {
    if (!session) return;
    const opts = processOpts();
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      await session.addImage(file, opts);
      sync();
    }
  });
}

/** Переснять страницу (заменить изображение, сохранив позицию). */
export async function retakePage(id: string): Promise<void> {
  await withBusy(async () => {
    if (!session) return;
    const files = await getCamera().capture({ multiple: false, facing: 'environment' });
    if (files[0]) {
      await session.replacePage(id, files[0], processOpts());
      sync();
    }
  });
}

/** Удалить страницу. */
export async function removePage(id: string): Promise<void> {
  if (!session) return;
  await session.removePage(id);
  sync();
}

/** Переместить страницу в ленте. */
export function movePage(from: number, to: number): void {
  if (!session) return;
  session.reorder(from, to);
  sync();
}

/** Собрать книгу и сохранить в библиотеку. */
export async function finishScanner(
  format: OutputFormat,
  meta: ScanBookMeta,
  opts: AssembleOptions = {},
): Promise<void> {
  await withBusy(async () => {
    if (!session || session.pages.length === 0) {
      throw new Error('Добавьте хотя бы одну страницу');
    }
    assembleProgress.set({ done: 0, total: session.pages.length });
    await saveScannedBook(
      session,
      format,
      meta,
      (done, total) => assembleProgress.set({ done, total }),
      opts,
    );
    await session.dispose();
    session = null;
    assembleProgress.set(null);
    await refreshLibrary();
    view.set({ name: 'library' });
  });
}

/** Отменить сканирование и очистить сессию. */
export async function cancelScanner(): Promise<void> {
  await session?.dispose();
  session = null;
  pages.set([]);
  assembleProgress.set(null);
  view.set({ name: 'library' });
}
