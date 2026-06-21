/**
 * Конвертер обычного текста (TXT) → единая модель документа.
 * Разбиваем на абзацы по пустым строкам, экранируем спецсимволы.
 */
import type { Converter, NormalizedDoc } from '../types';
import { escapeXml } from '../epub/build';

function textToHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const inner = escapeXml(p.trim()).replace(/\n/g, '<br/>');
      return inner ? `<p>${inner}</p>` : '';
    })
    .filter(Boolean)
    .join('\n');
}

export const textConverter: Converter = {
  name: 'text',
  formats: ['txt'],
  async convert(file): Promise<NormalizedDoc> {
    const text = await file.text();
    return {
      metadata: { language: 'ru' },
      chapters: [{ id: 'ch1', html: textToHtml(text) }],
    };
  },
};
