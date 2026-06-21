/**
 * Минимальный конвертер ODT → единая модель документа.
 * ODT — это ZIP с content.xml (формат ODF). Извлекаем заголовки и абзацы
 * (text:h / text:p) в порядке следования. Не полноценный рендер, а надёжное
 * извлечение читаемого текста с базовой структурой.
 */
import { unzipSync, strFromU8 } from 'fflate';
import type { Converter, NormalizedDoc } from '../types';

/** Убрать внутренние теги ODF, оставив текст с XML-сущностями. */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function contentToHtml(xml: string): string {
  const parts: string[] = [];
  // Захватываем text:h и text:p в порядке появления.
  const re = /<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const kind = m[1];
    const attrs = m[2];
    const inner = stripTags(m[3]).trim();
    if (!inner) continue;
    if (kind === 'h') {
      const lvl = /outline-level="(\d)"/.exec(attrs)?.[1];
      const tag = lvl && +lvl <= 6 ? `h${Math.max(1, +lvl)}` : 'h2';
      parts.push(`<${tag}>${inner}</${tag}>`);
    } else {
      parts.push(`<p>${inner}</p>`);
    }
  }
  return parts.join('\n');
}

export const odtConverter: Converter = {
  name: 'odt',
  formats: ['odt'],
  async convert(file): Promise<NormalizedDoc> {
    const buf = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buf);
    const content = files['content.xml'] ? strFromU8(files['content.xml']) : '';
    const meta = files['meta.xml'] ? strFromU8(files['meta.xml']) : '';

    const title =
      /<dc:title>([\s\S]*?)<\/dc:title>/.exec(meta)?.[1]?.trim() || undefined;
    const html = contentToHtml(content);

    return {
      metadata: { title, language: 'ru' },
      chapters: [{ id: 'ch1', title, html }],
    };
  },
};
