/** Типы сканера книг (Фаза 2.5). */

/** Форматы сборки на выходе. */
export type OutputFormat = 'cbz' | 'pdf' | 'epub';

/**
 * Страница в сессии сканирования.
 * Само изображение НЕ держим в памяти — оно лежит в OPFS под opfsName.
 * В RAM только превью (маленький data-URL) для ленты страниц.
 */
export interface ScanPage {
  /** Уникальный id страницы. */
  id: string;
  /** Имя файла в OPFS (каталог сессии). */
  opfsName: string;
  /** MIME обработанного изображения (image/jpeg). */
  type: string;
  /** Ширина обработанного изображения, px. */
  width: number;
  /** Высота обработанного изображения, px. */
  height: number;
  /** Размер обработанного изображения, байт. */
  size: number;
  /** Маленькое превью для ленты (data-URL). */
  thumb: string;
}

/** Метаданные собираемой книги. */
export interface ScanBookMeta {
  title: string;
  author?: string;
  /** id страницы, используемой как обложка (по умолчанию — первая). */
  coverPageId?: string;
}

/** Параметры обработки изображения при добавлении страницы. */
export interface ProcessOptions {
  /** Максимальная длинная сторона, px (даунскейл). */
  maxSide: number;
  /** Качество JPEG, 0..1. */
  quality: number;
  /** Применить улучшение (Ч/Б документ). */
  enhance: boolean;
  /** Авто-обрезка листа + коррекция перспективы (OpenCV, лениво). */
  autoCrop: boolean;
}

export const DEFAULT_PROCESS: ProcessOptions = {
  maxSide: 2000,
  quality: 0.82,
  enhance: true,
  autoCrop: true,
};
