/**
 * Stage B: searchable PDF из сфотографированных страниц (ТЗ Фаза 2).
 * Каждая страница — изображение + НЕВИДИМЫЙ текстовый слой из OCR: текст
 * выбирается/копируется/ищется, но визуально не виден (рисуем с opacity 0).
 *
 * Кириллический шрифт берём из уже вендорённого Liberation Sans (OFL),
 * который foliate-js отдаёт как статику — нового ассета не нужно.
 *
 * Обрабатываем по странице (контроль памяти на слабых устройствах).
 */
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ocrWords } from '@reader/converters';
import type { ScanSession } from '../session';
import type { AssembleProgress } from './cbz';

/** Вендорённый Liberation Sans (есть кириллица), отдаётся foliate-js статикой. */
const FONT_URL = '/foliate-js/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf';

/** PNG по сигнатуре (иначе считаем JPEG — формат страниц сканера). */
function isPng(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  );
}

/** Собрать searchable PDF из сессии: страница-картинка + невидимый OCR-слой. */
export async function buildSearchablePdf(
  session: ScanSession,
  onProgress?: AssembleProgress,
): Promise<Blob> {
  const total = session.pages.length;
  if (total === 0) throw new Error('Нет страниц для сборки');

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await fetch(FONT_URL).then((r) => {
    if (!r.ok) throw new Error('Не удалось загрузить шрифт для текстового слоя');
    return r.arrayBuffer();
  });
  const font = await pdf.embedFont(fontBytes, { subset: true });

  for (let i = 0; i < total; i++) {
    const page = session.pages[i];
    const blob = await session.getPageBlob(page);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const image = isPng(bytes) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const pw = page.width;
    const ph = page.height;
    const pdfPage = pdf.addPage([pw, ph]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: pw, height: ph });

    // Невидимый текстовый слой: координаты OCR — от левого верха, PDF — от низа.
    const words = await ocrWords(blob);
    for (const w of words) {
      const h = w.y1 - w.y0;
      if (h <= 0) continue;
      try {
        pdfPage.drawText(w.text, {
          x: w.x0,
          y: ph - w.y1,
          size: Math.max(1, h * 0.8),
          font,
          opacity: 0,
        });
      } catch {
        // Символ вне шрифта — пропускаем слово, страница остаётся валидной.
      }
    }

    onProgress?.(i + 1, total);
  }

  const out = await pdf.save();
  return new Blob([out as BlobPart], { type: 'application/pdf' });
}
