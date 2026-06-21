/**
 * Базовое улучшение фото страницы: оттенки серого + повышение контраста
 * («Ч/Б документ»). Это лёгкий canvas-фильтр без внешних зависимостей.
 *
 * Полноценная коррекция перспективы и удаление теней (OpenCV.js / jscanify)
 * — Stage B, грузится лениво. Здесь — быстрый дешёвый базовый проход.
 */

/**
 * Преобразовать содержимое canvas в улучшенный документ-вид.
 * Передаётся как transform в rasterize() — работает на уже уменьшенном кадре.
 */
export function enhanceDocument(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // 1) Оттенки серого + сбор гистограммы для авто-уровней.
  const gray = new Uint8ClampedArray(w * h);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    // Восприятие яркости (Rec. 601).
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  // 2) Растяжение контраста по 2–98 перцентилям (устойчивее к бликам/теням).
  const hist = new Uint32Array(256);
  for (let p = 0; p < gray.length; p++) hist[gray[p]]++;
  const total = gray.length;
  const loCut = total * 0.02;
  const hiCut = total * 0.98;
  let acc = 0;
  let lo = min;
  let hi = max;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= loCut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= hiCut) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);

  // 3) Применяем уровни + лёгкая гамма для читаемости текста.
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    let v = ((gray[p] - lo) / range) * 255;
    v = Math.max(0, Math.min(255, v));
    v = 255 * Math.pow(v / 255, 0.9);
    const o = v | 0;
    d[i] = o;
    d[i + 1] = o;
    d[i + 2] = o;
  }

  ctx.putImageData(img, 0, 0);
}
