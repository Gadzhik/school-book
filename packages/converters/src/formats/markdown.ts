/**
 * Конвертер Markdown → единая модель документа через marked (MIT).
 * Результат прогоняем через санитайзер для безопасности.
 */
import { marked } from 'marked';
import type { Converter, NormalizedDoc } from '../types';
import { sanitizeHtml } from '../sanitize';

export const markdownConverter: Converter = {
  name: 'markdown',
  formats: ['md'],
  async convert(file): Promise<NormalizedDoc> {
    const md = await file.text();
    const html = await marked.parse(md, { async: true });
    const { title, bodyHtml } = sanitizeHtml(`<body>${html}</body>`);
    return {
      metadata: { title, language: 'ru' },
      chapters: [{ id: 'ch1', title, html: bodyHtml }],
    };
  },
};
