/**
 * Определение формата файла по сигнатуре (magic bytes), а не по расширению.
 * Требование ТЗ: приложение само распознаёт формат при добавлении.
 *
 * На Фазе 0 это используется для метаданных и иконок; реальный разбор
 * выполняет foliate-js (он тоже детектит формат самостоятельно).
 */
import type { BookFormat } from './types';

/** Прочитать первые N байт файла. */
async function head(file: Blob, n: number): Promise<Uint8Array> {
  const buf = await file.slice(0, n).arrayBuffer();
  return new Uint8Array(buf);
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Определить формат книги.
 * ZIP-контейнеры (EPUB, FB2.zip, CBZ, DOCX...) начинаются с "PK\x03\x04",
 * поэтому при необходимости заглядываем внутрь по имени расширения файла.
 */
export async function detectFormat(file: File): Promise<BookFormat> {
  const bytes = await head(file, 64);
  const ext = file.name.toLowerCase();

  // PDF: "%PDF"
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';

  // RAR (CBR): "Rar!\x1A\x07"
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'cbr';

  // ZIP-контейнер: "PK\x03\x04"
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext.endsWith('.epub')) return 'epub';
    if (ext.endsWith('.cbz')) return 'cbz';
    if (ext.endsWith('.docx')) return 'docx';
    if (ext.endsWith('.odt')) return 'odt';
    if (ext.endsWith('.fb2.zip') || ext.endsWith('.fbz')) return 'fb2.zip';
    // EPUB/ODT можно подтвердить по mimetype в начале архива.
    const text = decoder.decode(bytes);
    if (text.includes('mimetypeapplication/epub+zip')) return 'epub';
    if (text.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return 'odt';
    if (ext.endsWith('.zip')) return 'fb2.zip';
    return 'epub';
  }

  // RTF: "{\rtf"
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return 'rtf';

  // MOBI / AZW3: сигнатуры "BOOKMOBI" / "TPZ3" находятся со смещения 60.
  const at60 = decoder.decode(bytes.slice(60, 68));
  if (at60.startsWith('BOOKMOBI')) return 'mobi';
  if (ext.endsWith('.azw3') || ext.endsWith('.kf8')) return 'azw3';

  // FB2: XML с корневым элементом <FictionBook>.
  const text = decoder.decode(bytes);
  if (text.includes('<?xml') && /FictionBook/i.test(text)) return 'fb2';
  if (ext.endsWith('.fb2')) return 'fb2';

  // HTML — по сигнатуре содержимого или расширению.
  if (/<!doctype html|<html[\s>]/i.test(text)) return 'html';
  if (ext.endsWith('.html') || ext.endsWith('.htm')) return 'html';

  // Markdown / TXT — по расширению.
  if (ext.endsWith('.md') || ext.endsWith('.markdown')) return 'md';
  if (ext.endsWith('.txt')) return 'txt';

  return 'unknown';
}

/** Человекочитаемое имя формата для интерфейса. */
export function formatLabel(format: BookFormat): string {
  const map: Record<BookFormat, string> = {
    epub: 'EPUB',
    fb2: 'FB2',
    'fb2.zip': 'FB2.zip',
    mobi: 'MOBI',
    azw3: 'AZW3',
    pdf: 'PDF',
    cbz: 'CBZ',
    cbr: 'CBR',
    html: 'HTML',
    md: 'Markdown',
    txt: 'TXT',
    docx: 'DOCX',
    rtf: 'RTF',
    odt: 'ODT',
    unknown: 'Неизвестно',
  };
  return map[format];
}
