/**
 * Сжатие PDF (mupdf clean): корректность на реальном wasm-движке.
 * Фикстура — минимальный PDF с большим НЕсжатым потоком: deflate обязан
 * заметно ужать; результат должен остаться валидным PDF с той же страницей.
 */
import { describe, expect, it } from 'vitest';
import { compressPdf } from './pdf-compress';

/** Собрать минимальный валидный PDF c несжатым текстовым потоком. */
function makePdf(streamRepeat = 20000): File {
  const content = 'BT /F1 12 Tf 72 720 Td (Hello) Tj ET\n' + '% pad\n'.repeat(streamRepeat);
  const body = [
    '%PDF-1.4\n',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R' +
      '/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ];
  // Оффсеты начал объектов 1..5 — для честной таблицы xref.
  let pos = 0;
  const starts: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (i > 0) starts.push(pos);
    pos += body[i].length;
  }
  const xrefPos = pos;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (const s of starts) xref += `${String(s).padStart(10, '0')} 00000 n \n`;
  const tail = `${xref}trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;
  const bytes = new TextEncoder().encode(body.join('') + tail);
  return new File([bytes], 'fixture.pdf', { type: 'application/pdf' });
}

describe('compressPdf', () => {
  it('ужимает PDF с несжатыми потоками и остаётся валидным', async () => {
    const src = makePdf();
    const r = await compressPdf(src);
    expect(r.compressed).toBe(true);
    expect(r.after).toBeLessThan(r.before);
    expect(r.file.name).toBe('fixture.pdf');
    // Результат открывается mupdf'ом и страница на месте.
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(
      new Uint8Array(await r.file.arrayBuffer()),
      'application/pdf',
    );
    try {
      expect(doc.countPages()).toBe(1);
    } finally {
      doc.destroy();
    }
  });

  it('не подменяет файл, если сжатие не уменьшило (уже оптимален)', async () => {
    const src = makePdf();
    const once = await compressPdf(src);
    const twice = await compressPdf(once.file);
    // Повторное сжатие уже сжатого не должно давать выигрыша…
    // (допускаем небольшие колебания — главное, флаг и размер согласованы)
    if (!twice.compressed) {
      expect(twice.file).toBe(once.file);
      expect(twice.after).toBe(twice.before);
    } else {
      expect(twice.after).toBeLessThan(twice.before);
    }
  });
});
