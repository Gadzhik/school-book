/**
 * Конвертер HTML → единая модель документа.
 * Очищает разметку и кладёт её одной главой (TOC можно усложнить позже).
 */
import type { Converter, NormalizedDoc } from '../types';
import { sanitizeHtml } from '../sanitize';

export const htmlConverter: Converter = {
  name: 'html',
  formats: ['html'],
  async convert(file): Promise<NormalizedDoc> {
    const raw = await file.text();
    const { title, bodyHtml } = sanitizeHtml(raw);
    return {
      metadata: { title, language: 'ru' },
      chapters: [{ id: 'ch1', title, html: bodyHtml }],
    };
  },
};
