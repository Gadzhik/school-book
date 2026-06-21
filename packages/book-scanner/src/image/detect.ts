/// <reference path="./jscanify-client.d.ts" />
/**
 * Stage B: авто-поиск листа в кадре + коррекция перспективы (выправление
 * перекоса фото под углом). Тяжёлый OpenCV.js (~10МБ wasm) грузится ЛЕНИВО
 * только при первом вызове — не попадает в основной бандл.
 *
 * OpenCV отдаётся как статический ассет по /opencv/opencv.js (вендорён из
 * @techstark/opencv-js, как foliate/tesseract) и кэшируется Service Worker'ом.
 * jscanify (MIT) — лёгкая обёртка corner-detection поверх глобального `cv`.
 *
 * Если лист не найден или результат подозрительный — возвращаем null, и
 * вызывающий код оставляет исходный кадр (обрезка — «магия», не обязаловка).
 */

/** Путь к вендорённому OpenCV.js (см. vite.config static-copy + SW кэш). */
const OPENCV_URL = '/opencv/opencv.js';

interface CvLike {
  Mat: unknown;
  imread(src: HTMLCanvasElement): unknown;
  onRuntimeInitialized?: () => void;
}

let cvPromise: Promise<CvLike> | null = null;

/** Лениво загрузить OpenCV.js (один раз за сессию страницы). */
function loadOpenCv(): Promise<CvLike> {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise<CvLike>((resolve, reject) => {
    const g = globalThis as unknown as { cv?: CvLike };
    // Уже загружен и инициализирован.
    if (g.cv && (g.cv as CvLike).Mat) {
      resolve(g.cv);
      return;
    }
    const ready = () => {
      const cv = (globalThis as unknown as { cv?: CvLike }).cv;
      if (cv && cv.Mat) resolve(cv);
      else reject(new Error('OpenCV загрузился, но runtime не готов'));
    };
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-opencv]`,
    );
    const onScript = (cv: CvLike) => {
      // OpenCV.js инициализирует wasm асинхронно после загрузки скрипта.
      if (cv.Mat) ready();
      else cv.onRuntimeInitialized = ready;
    };
    if (existing) {
      const cv = (globalThis as unknown as { cv?: CvLike }).cv;
      if (cv) onScript(cv);
      else existing.addEventListener('load', () => {
        const c = (globalThis as unknown as { cv?: CvLike }).cv;
        if (c) onScript(c);
        else reject(new Error('OpenCV не определил глобальный cv'));
      });
      return;
    }
    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.dataset.opencv = '1';
    script.onload = () => {
      const cv = (globalThis as unknown as { cv?: CvLike }).cv;
      if (cv) onScript(cv);
      else reject(new Error('OpenCV не определил глобальный cv'));
    };
    script.onerror = () => reject(new Error('Не удалось загрузить OpenCV.js'));
    document.head.appendChild(script);
  }).catch((err) => {
    cvPromise = null; // дать шанс повторить позже
    throw err;
  });
  return cvPromise;
}

interface Point {
  x: number;
  y: number;
}
interface Corners {
  topLeftCorner?: Point;
  topRightCorner?: Point;
  bottomLeftCorner?: Point;
  bottomRightCorner?: Point;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Загрузить blob в canvas, уменьшив длинную сторону до maxSide. */
async function blobToCanvas(blob: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas 2D-контекст недоступен');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Не удалось закодировать JPEG'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Найти лист и выправить перспективу. Возвращает обрезанный JPEG-Blob, либо
 * null если лист не обнаружен / результат неправдоподобен (тогда — исходник).
 *
 * Работаем на уменьшенной копии (контроль памяти, ТЗ фичи); итог тоже ≤maxSide.
 */
export async function detectAndCrop(
  blob: Blob,
  maxSide = 2000,
  quality = 0.85,
): Promise<Blob | null> {
  // OpenCV-типы динамические — работаем через any, изолированно в этой функции.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const cv = (await loadOpenCv()) as any;
  const { default: Jscanify } = await import('jscanify/client');
  const scanner = new (Jscanify as any)();

  const canvas = await blobToCanvas(blob, maxSide);
  const cw = canvas.width;
  const ch = canvas.height;
  let mat: any = null;
  let contour: any = null;
  try {
    mat = cv.imread(canvas);
    contour = scanner.findPaperContour(mat);
    if (!contour) return null;

    const c: Corners = scanner.getCornerPoints(contour);
    const { topLeftCorner: tl, topRightCorner: tr, bottomLeftCorner: bl, bottomRightCorner: br } = c;
    if (!tl || !tr || !bl || !br) return null;

    // Размер результата — по сторонам найденного четырёхугольника.
    const outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
    const outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
    if (outW < 8 || outH < 8) return null;

    // Защита от ложного срабатывания: лист должен занимать заметную долю кадра.
    // Площадь четырёхугольника (формула шнурков) против площади всего кадра.
    const quadArea = Math.abs(
      (tl.x * tr.y - tr.x * tl.y) +
        (tr.x * br.y - br.x * tr.y) +
        (br.x * bl.y - bl.x * br.y) +
        (bl.x * tl.y - tl.x * bl.y),
    ) / 2;
    const frac = quadArea / (cw * ch);
    // Слишком маленький (мусор/буква) или почти весь кадр (рамки нет) — пропуск.
    if (frac < 0.2 || frac > 0.985) return null;

    const result: HTMLCanvasElement | null = scanner.extractPaper(canvas, outW, outH, c);
    if (!result) return null;
    const cropped = await canvasToBlob(result, quality);
    result.width = 0;
    result.height = 0;
    return cropped;
  } catch {
    return null; // любая ошибка детекции — мягкий откат к исходнику
  } finally {
    if (mat) mat.delete();
    canvas.width = 0;
    canvas.height = 0;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Доступна ли авто-обрезка в текущей среде (нужен браузер с canvas). */
export function autoCropSupported(): boolean {
  return typeof document !== 'undefined' && typeof createImageBitmap === 'function';
}
