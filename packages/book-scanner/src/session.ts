/**
 * Сессия сканирования: набор страниц с хранением изображений в OPFS.
 * В оперативной памяти держим только метаданные + маленькие превью,
 * сами кадры читаем из OPFS по требованию (сборка, обложка).
 */
import { rasterize, makeThumb } from './image/downscale';
import { enhanceDocument } from './image/enhance';
import { detectAndCrop } from './image/detect';
import { DEFAULT_PROCESS, type ProcessOptions, type ScanPage } from './types';

function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Каталог сессии в OPFS: /scanner/<sessionId>/ */
async function sessionDir(sessionId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const scanner = await root.getDirectoryHandle('scanner', { create: true });
  return scanner.getDirectoryHandle(sessionId, { create: true });
}

export class ScanSession {
  readonly id: string;
  pages: ScanPage[] = [];

  constructor(id = uid()) {
    this.id = id;
  }

  /** Доступно ли хранилище OPFS (нужно для работы сканера). */
  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      typeof navigator.storage.getDirectory === 'function'
    );
  }

  /**
   * Добавить изображение страницы: даунскейл (+улучшение) → запись в OPFS → превью.
   * Обрабатываем строго по одной странице (контроль памяти).
   */
  async addImage(file: Blob, opts: ProcessOptions = DEFAULT_PROCESS): Promise<ScanPage> {
    // Авто-обрезка листа + перспектива (лениво, мягкий откат к исходнику).
    let src: Blob = file;
    if (opts.autoCrop) {
      try {
        const cropped = await detectAndCrop(file, opts.maxSide);
        if (cropped) src = cropped;
      } catch {
        /* детекция упала — берём исходный кадр */
      }
    }
    const { blob, width, height } = await rasterize(
      src,
      opts.maxSide,
      opts.quality,
      opts.enhance ? enhanceDocument : undefined,
    );
    const thumb = await makeThumb(blob, 200);

    const id = uid();
    const opfsName = `${id}.jpg`;
    const dir = await sessionDir(this.id);
    const handle = await dir.getFileHandle(opfsName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();

    const page: ScanPage = {
      id,
      opfsName,
      type: 'image/jpeg',
      width,
      height,
      size: blob.size,
      thumb,
    };
    this.pages.push(page);
    return page;
  }

  /** Прочитать изображение страницы из OPFS. */
  async getPageBlob(page: ScanPage): Promise<Blob> {
    const dir = await sessionDir(this.id);
    const handle = await dir.getFileHandle(page.opfsName);
    return handle.getFile();
  }

  /** Удалить страницу (из OPFS и из списка). */
  async removePage(id: string): Promise<void> {
    const idx = this.pages.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const [page] = this.pages.splice(idx, 1);
    try {
      const dir = await sessionDir(this.id);
      await dir.removeEntry(page.opfsName);
    } catch {
      /* нет файла — ок */
    }
  }

  /** Переснять страницу: заменить изображение, сохранив позицию. */
  async replacePage(
    id: string,
    file: Blob,
    opts: ProcessOptions = DEFAULT_PROCESS,
  ): Promise<void> {
    const idx = this.pages.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const page = await this.addImage(file, opts);
    // addImage добавил в конец — переносим на место заменяемого и удаляем старую.
    this.pages.pop();
    const old = this.pages[idx];
    this.pages[idx] = page;
    try {
      const dir = await sessionDir(this.id);
      await dir.removeEntry(old.opfsName);
    } catch {
      /* ок */
    }
  }

  /** Переместить страницу (перетаскивание в ленте). */
  reorder(from: number, to: number): void {
    if (from < 0 || from >= this.pages.length) return;
    const clampedTo = Math.max(0, Math.min(this.pages.length - 1, to));
    const [p] = this.pages.splice(from, 1);
    this.pages.splice(clampedTo, 0, p);
  }

  /** Удалить всю сессию из OPFS (после сборки или отмены). */
  async dispose(): Promise<void> {
    this.pages = [];
    try {
      const root = await navigator.storage.getDirectory();
      const scanner = await root.getDirectoryHandle('scanner', { create: true });
      await scanner.removeEntry(this.id, { recursive: true });
    } catch {
      /* ок */
    }
  }
}
