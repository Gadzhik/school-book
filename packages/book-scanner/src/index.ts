/**
 * Публичный API пакета @reader/book-scanner (Фаза 2.5).
 * Stage A: захват → обработка → управление страницами → сборка CBZ → библиотека.
 */
export * from './types';
export { ScanSession } from './session';
export { rasterize, makeThumb } from './image/downscale';
export { enhanceDocument } from './image/enhance';
export { detectAndCrop, autoCropSupported } from './image/detect';
export { assembleBook, buildCbz } from './assemble';
export { buildOcrEpub } from './assemble/epub';
export type { AssembleProgress, AssembleResult, AssembleOptions } from './assemble';
export { saveScannedBook } from './library';
