/**
 * Загрузка pdf.js из вендорённой статики foliate-js (/foliate-js/vendor/pdfjs).
 * Используем уже включённую сборку pdf.js (Apache-2.0) — не тянем mupdf-wasm
 * (AGPL, риск для дистрибутива, ТЗ 2.7). Модуль pdf.mjs при импорте выставляет
 * globalThis.pdfjsLib.
 */

const PDFJS_BASE = '/foliate-js/vendor/pdfjs';

type PdfjsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: unknown) => { promise: Promise<PdfDocumentProxy> };
};

export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}
export interface PdfViewport {
  width: number;
  height: number;
}
export interface PdfPageProxy {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => { promise: Promise<void> };
  cleanup?: () => void;
}
export interface PdfDocumentProxy {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageProxy>;
  getMetadata: () => Promise<{ info?: Record<string, unknown> }>;
}

let lib: PdfjsLib | null = null;

/** Загрузить (однократно) pdf.js и настроить воркер. */
export async function loadPdfjs(): Promise<PdfjsLib> {
  if (!lib) {
    await import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.mjs`);
    lib = (globalThis as unknown as { pdfjsLib: PdfjsLib }).pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.mjs`;
  }
  return lib;
}

/** Параметры getDocument с путями к ресурсам pdf.js. */
export function pdfDocOptions(data: Uint8Array): Record<string, unknown> {
  return {
    data,
    cMapUrl: `${PDFJS_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
  };
}
