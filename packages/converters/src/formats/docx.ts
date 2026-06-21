/**
 * Конвертер DOCX → единая модель документа через mammoth (MIT).
 * mammoth даёт чистый семантический HTML (заголовки, списки, выделение).
 * Используем браузерную сборку, чтобы не тянуть node-зависимости в бандл.
 */
import type { Converter, NormalizedDoc } from '../types';
import { sanitizeHtml } from '../sanitize';
// Браузерная сборка mammoth без типов (избегаем node-зависимостей в бандле).
// @ts-expect-error — у подпути нет деклараций типов.
import mammoth from 'mammoth/mammoth.browser';

interface MammothResult {
  value: string;
  messages: unknown[];
}
const convertDocx = mammoth.convertToHtml as (i: {
  arrayBuffer: ArrayBuffer;
}) => Promise<MammothResult>;

export const docxConverter: Converter = {
  name: 'docx',
  formats: ['docx'],
  async convert(file): Promise<NormalizedDoc> {
    const arrayBuffer = await file.arrayBuffer();
    const result = await convertDocx({ arrayBuffer });
    const { title, bodyHtml } = sanitizeHtml(`<body>${result.value}</body>`);
    return {
      metadata: { title, language: 'ru' },
      chapters: [{ id: 'ch1', title, html: bodyHtml }],
    };
  },
};
