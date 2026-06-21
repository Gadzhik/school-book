/**
 * Даунскейл изображения и кодирование в JPEG через canvas.
 * Память — главный риск (ТЗ фичи): обрабатываем по одной странице,
 * освобождаем canvas и bitmap сразу после использования.
 */

export interface RasterResult {
  blob: Blob;
  width: number;
  height: number;
}

/** Загрузить изображение из файла в ImageBitmap (с учётом ориентации EXIF). */
async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * Уменьшить изображение так, чтобы длинная сторона была не больше maxSide,
 * и закодировать в JPEG. Возвращает blob + итоговые размеры.
 * @param transform — необязательная функция пиксельной обработки (улучшение).
 */
export async function rasterize(
  file: Blob,
  maxSide: number,
  quality: number,
  transform?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Promise<RasterResult> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas 2D-контекст недоступен');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close(); // освобождаем исходник немедленно

  if (transform) transform(ctx, w, h);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Не удалось закодировать JPEG'))),
      'image/jpeg',
      quality,
    );
  });

  // Освобождаем canvas (сжимаем до 0, помогаем GC).
  canvas.width = 0;
  canvas.height = 0;

  return { blob, width: w, height: h };
}

/** Сделать маленькое превью (data-URL) для ленты страниц. */
export async function makeThumb(file: Blob, maxSide = 200): Promise<string> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return '';
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', 0.6);
  canvas.width = 0;
  canvas.height = 0;
  return url;
}
