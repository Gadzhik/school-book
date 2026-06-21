/**
 * Извлечение метаданных книги для авторазметки (ТЗ 5.4, источник #1).
 * Лёгкое чтение «шапки» без полного открытия в движке:
 *  - EPUB/fb2.zip: распаковываем zip и парсим OPF / FB2-XML regex'ом;
 *  - FB2 (plain): парсим XML-строку (учитываем кодировку из декларации).
 *
 * Парсим regex'ом, а не DOMParser — работает и в браузере, и в node/воркере
 * (как sanitize.ts), и устойчиво к пространствам имён.
 */
import { unzipSync, strFromU8 } from 'fflate';
import type { BookFormat } from '@reader/core';

/** Метаданные, полезные для авторазметки и уточнения карточки книги. */
export interface BookMetadata {
  title?: string;
  author?: string;
  language?: string;
  /** Свободные предметные метки: EPUB `dc:subject`, ключевые слова. */
  keywords: string[];
  /** Коды жанров FB2 (`<genre>`), напр. 'sci_phys'. */
  fb2Genres: string[];
  /** Название серии/коллекции. */
  series?: string;
}

const EMPTY: BookMetadata = { keywords: [], fb2Genres: [] };

/** Снять XML-теги и привести сущности/пробелы к человекочитаемому виду. */
function decodeText(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Все вхождения текста тега (без namespace-префикса), напр. 'subject'. */
function tagTexts(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${local}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const t = decodeText(m[1]);
    if (t) out.push(t);
  }
  return out;
}

/** Декодировать байты FB2 с учётом кодировки из XML-декларации (часто cp1251). */
function decodeXmlBytes(bytes: Uint8Array): string {
  // Заголовок читаем как latin1, чтобы достать объявленную кодировку.
  const head = strFromU8(bytes.subarray(0, 200), true);
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch {
      /* неизвестная кодировка — падаем на utf-8 ниже */
    }
  }
  return strFromU8(bytes);
}

/** Разобрать FB2-XML (берём только блок <title-info>). */
function parseFb2(xml: string): BookMetadata {
  const ti = /<title-info\b[^>]*>([\s\S]*?)<\/title-info>/i.exec(xml)?.[1] ?? xml;
  const author = (() => {
    const a = /<author\b[^>]*>([\s\S]*?)<\/author>/i.exec(ti)?.[1];
    if (!a) return undefined;
    const fn = tagTexts(a, 'first-name')[0] ?? '';
    const ln = tagTexts(a, 'last-name')[0] ?? '';
    const full = `${fn} ${ln}`.trim();
    return full || tagTexts(a, 'nickname')[0];
  })();
  const series = /<sequence\b[^>]*\bname=["']([^"']+)["']/i.exec(ti)?.[1];
  return {
    title: tagTexts(ti, 'book-title')[0],
    author,
    language: tagTexts(ti, 'lang')[0],
    keywords: tagTexts(ti, 'keywords').flatMap((k) => k.split(/[,;]/).map((s) => s.trim())).filter(Boolean),
    fb2Genres: tagTexts(ti, 'genre').map((g) => g.toLowerCase()),
    series: series ? decodeText(series) : undefined,
  };
}

/** Разобрать OPF (EPUB): Dublin Core + серия (calibre / belongs-to-collection). */
function parseOpf(xml: string): BookMetadata {
  // Серия: EPUB2 calibre:series или EPUB3 belongs-to-collection.
  const calibre = /<meta\b[^>]*\bname=["']calibre:series["'][^>]*\bcontent=["']([^"']+)["']/i.exec(xml)?.[1];
  const epub3 = /<meta\b[^>]*\bproperty=["']belongs-to-collection["'][^>]*>([\s\S]*?)<\/meta>/i.exec(xml)?.[1];
  return {
    title: tagTexts(xml, 'title')[0],
    author: tagTexts(xml, 'creator')[0],
    language: tagTexts(xml, 'language')[0],
    keywords: tagTexts(xml, 'subject'),
    fb2Genres: [],
    series: calibre ?? (epub3 ? decodeText(epub3) : undefined),
  };
}

/** Найти и прочитать OPF внутри распакованного EPUB. */
function readOpfFromZip(files: Record<string, Uint8Array>): string | undefined {
  // container.xml указывает на rootfile (точный путь к OPF).
  const container = files['META-INF/container.xml'];
  if (container) {
    const path = /full-path=["']([^"']+\.opf)["']/i.exec(strFromU8(container))?.[1];
    if (path && files[path]) return strFromU8(files[path]);
  }
  // Фолбэк: первый .opf в архиве.
  const opfName = Object.keys(files).find((n) => n.toLowerCase().endsWith('.opf'));
  return opfName ? strFromU8(files[opfName]) : undefined;
}

/** Найти и прочитать FB2 внутри fb2.zip (учитывая кодировку). */
function readFb2FromZip(files: Record<string, Uint8Array>): string | undefined {
  const name = Object.keys(files).find((n) => /\.fb2$/i.test(n));
  return name ? decodeXmlBytes(files[name]) : undefined;
}

/**
 * Извлечь метаданные книги. Поддержаны EPUB, FB2 и fb2.zip;
 * для прочих форматов возвращается пустой результат (источник #1 не применим).
 * Никогда не бросает — при сбое отдаёт пустые метаданные.
 */
export async function extractBookMetadata(
  file: File,
  format: BookFormat,
): Promise<BookMetadata> {
  try {
    if (format === 'epub') {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const opf = readOpfFromZip(files);
      return opf ? parseOpf(opf) : EMPTY;
    }
    if (format === 'fb2.zip') {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const xml = readFb2FromZip(files);
      return xml ? parseFb2(xml) : EMPTY;
    }
    if (format === 'fb2') {
      return parseFb2(decodeXmlBytes(new Uint8Array(await file.arrayBuffer())));
    }
  } catch {
    /* битый архив/XML — отдаём пустые метаданные */
  }
  return EMPTY;
}
