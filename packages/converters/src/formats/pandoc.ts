/// <reference path="../pandoc-wasm.d.ts" />
/**
 * Альтернативный конвертер документов через pandoc-wasm (DOCX/RTF/ODT/HTML/MD
 * → EPUB одним движком). Взаимозаменяем со встроенными адаптерами (mammoth/
 * свои парсеры) — ТЗ ч.3 п.13: адаптеры как плагины. НЕ дефолт.
 *
 * ⚠️ Очень тяжёлый: pandoc.wasm ~58 МБ. Грузим лениво — только когда
 * пользователь явно выбрал pandoc (настройка). Базовый бандл не растёт;
 * wasm кэшируется по запросу. Лицензия pandoc — GPL-2.0+ (как у Calibre,
 * ТЗ 2.7): для дистрибуции учесть.
 */
import type { BookFormat } from '@reader/core';

/** Соответствие нашего формата → входной формат pandoc. */
const PANDOC_FROM: Partial<Record<BookFormat, string>> = {
  docx: 'docx',
  rtf: 'rtf',
  odt: 'odt',
  html: 'html',
  md: 'markdown',
};

/** Поддерживает ли pandoc-адаптер данный формат. */
export function pandocSupports(format: BookFormat): boolean {
  return format in PANDOC_FROM;
}

/** Лениво загрузить pandoc-wasm (тяжёлый WASM). */
async function loadPandoc(): Promise<typeof import('pandoc-wasm')> {
  return import('pandoc-wasm');
}

/**
 * Сконвертировать документ в EPUB через pandoc. EPUB бинарный, поэтому
 * запрашиваем вывод в файл (`output-file`) и забираем его как Blob.
 */
export async function pandocToEpubFile(file: File, format: BookFormat): Promise<File> {
  const from = PANDOC_FROM[format];
  if (!from) throw new Error(`pandoc: формат ${format} не поддержан`);

  const { convert } = await loadPandoc();
  const result = await convert({ from, to: 'epub', 'output-file': 'out.epub' }, file, {});
  const out = (result.files as Record<string, unknown>)['out.epub'];
  if (!(out instanceof Blob)) {
    throw new Error('pandoc: не удалось получить EPUB');
  }
  const name = `${file.name.replace(/\.[^./\\]+$/, '')} (pandoc).epub`;
  return new File([out], name, { type: 'application/epub+zip' });
}
