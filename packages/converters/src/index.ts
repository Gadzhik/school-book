/**
 * Публичный API пакета @reader/converters (Фаза 2).
 * Модуль 1: каркас — модель, сборка EPUB, реестр, импорт.
 * Конкретные конвертеры (HTML/DOCX/PDF/OCR) добавляются в следующих модулях.
 */
export * from './types';
export { buildEpub, escapeXml } from './epub/build';
export { registerConverter, findConverter, listConverters } from './registry';
export { importFile, type ImportResult, type ImportOptions } from './import';
// Альтернативный конвертер документов на pandoc-wasm (GPL, ~58МБ) — opt-in.
export { pandocToEpubFile, pandocSupports } from './formats/pandoc';
export { extractBookMetadata, type BookMetadata } from './metadata';
export { sanitizeHtml, type SanitizedHtml } from './sanitize';
// PDF→текст — по явному действию пользователя, не авто-регистрируется.
export {
  convertPdf,
  pdfToEpubFile,
  pdfOcrToEpubFile,
  NoTextLayerError,
  type PdfProgress,
  type OcrPdfProgress,
} from './formats/pdf';
export { ocrImage, ocrWords, terminateOcr, type OcrProgress, type OcrWord } from './ocr/tesseract';
// Альтернативный PDF-адаптер на mupdf-wasm (AGPL-3.0) — взаимозаменяем с pdf.js.
export { convertPdfMupdf, pdfMupdfToEpubFile } from './formats/pdf-mupdf';

// Побочный эффект: регистрируем встроенные конвертеры (HTML/MD/TXT/DOCX/RTF/ODT).
import './register-builtin';
