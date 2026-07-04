/**
 * Сжатие PDF без потери качества (mupdf-wasm): сборка мусора объектов,
 * дедупликация, пережатие потоков/шрифтов deflate'ом. Содержимое страниц,
 * картинки и текстовый слой НЕ меняются — это «mutool clean», не перегонка
 * в растр. Типичный выигрыш 10–40% (зависит от того, как PDF был собран).
 *
 * Вызывается явным действием (галочка «Сжать» у учителя/админа при загрузке
 * на сервер) — не автоматически. mupdf — AGPL, уже используется pdf-адаптером.
 */

/** Результат сжатия: файл и размеры до/после (байты). */
export interface CompressPdfResult {
  file: File;
  before: number;
  after: number;
  /** Файл реально уменьшился (иначе возвращён исходный). */
  compressed: boolean;
}

/**
 * Сжать PDF. Если «сжатый» вышел не меньше исходного (уже оптимален) —
 * возвращается исходный файл с compressed=false.
 */
export async function compressPdf(file: File): Promise<CompressPdfResult> {
  const mupdf = await import('mupdf');
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  try {
    if (!(doc instanceof mupdf.PDFDocument)) {
      // Не PDF (mupdf открыл как другой формат) — сжимать нечего.
      return { file, before: file.size, after: file.size, compressed: false };
    }
    const out = doc.saveToBuffer('garbage=4,compress,compress-images,compress-fonts');
    const bytes = out.asUint8Array();
    if (bytes.length >= file.size) {
      return { file, before: file.size, after: file.size, compressed: false };
    }
    // Копия в обычный ArrayBuffer: буфер mupdf живёт в памяти wasm.
    const compressed = new File([new Uint8Array(bytes)], file.name, {
      type: 'application/pdf',
    });
    return { file: compressed, before: file.size, after: compressed.size, compressed: true };
  } finally {
    doc.destroy();
  }
}
