/**
 * Web Worker авто-обрезки листа (Stage B). Держит OpenCV.js (~10МБ wasm) и
 * всю детекцию НА ОТДЕЛЬНОМ ПОТОКЕ — раньше компиляция wasm и Canny/contours
 * шли в главном потоке и замораживали вкладку на секунды-минуты при
 * добавлении фото (репорт владельца 2026-07-02).
 *
 * Протокол: in {id, image: ImageData, minFrac, maxFrac} →
 * out {id, ok, image: ImageData|null, error?}. image=null — лист не найден /
 * результат неправдоподобен (вызывающий оставит исходный кадр).
 *
 * Алгоритм — порт jscanify 1.4 (MIT, ColonelParrot): Canny → blur → Otsu →
 * максимальный контур → углы от центра minAreaRect → warpPerspective.
 * Порт нужен, потому что jscanify требует document/canvas — в воркере их нет,
 * а cv.matFromImageData/ImageData работают и в воркере.
 */

declare function importScripts(...urls: string[]): void;

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Pt {
  x: number;
  y: number;
}

// ВАЖНО: глобальный cv у OpenCV.js — THENABLE (эмскриптеновский Module с
// .then, который резолвится самим собой). resolve(cv)/await cv «усыновляет»
// thenable и зависает НАВСЕГДА — из-за этого добавление фото висело вечно.
// Поэтому cv всегда передаём завёрнутым в обычный объект-коробку.
let cvReady: Promise<{ mod: any }> | null = null;

/** Загрузить и дождаться инициализации OpenCV.js (один раз на воркер). */
function loadCv(): Promise<{ mod: any }> {
  if (cvReady) return cvReady;
  cvReady = new Promise<{ mod: any }>((resolve, reject) => {
    try {
      importScripts('/opencv/opencv.js');
    } catch (e) {
      cvReady = null;
      reject(e instanceof Error ? e : new Error('Не удалось загрузить OpenCV.js'));
      return;
    }
    // Emscripten инициализирует wasm асинхронно; надёжный сигнал — cv.Mat.
    const TIMEOUT_MS = 30000;
    const started = Date.now();
    const poll = setInterval(() => {
      const cv = (self as any).cv;
      if (cv && cv.Mat) {
        clearInterval(poll);
        resolve({ mod: cv });
      } else if (Date.now() - started > TIMEOUT_MS) {
        clearInterval(poll);
        cvReady = null;
        reject(new Error('OpenCV не инициализировался вовремя'));
      }
    }, 50);
  });
  return cvReady;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Найти лист и выправить перспективу. null — не найден/неправдоподобен. */
function detectAndWarp(
  cv: any,
  image: ImageData,
  minFrac: number,
  maxFrac: number,
  cropMargin: number,
): ImageData | null {
  const src = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const thresh = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let contour: any = null;
  let warped: any = null;
  try {
    cv.Canny(src, gray, 50, 200);
    cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.threshold(blur, thresh, 0, 255, cv.THRESH_OTSU);
    cv.findContours(thresh, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let maxIdx = -1;
    for (let i = 0; i < contours.size(); i++) {
      const a = cv.contourArea(contours.get(i));
      if (a > maxArea) {
        maxArea = a;
        maxIdx = i;
      }
    }
    if (maxIdx < 0) return null;
    contour = contours.get(maxIdx);

    // Углы: самые дальние от центра minAreaRect точки в каждом квадранте.
    const center: Pt = cv.minAreaRect(contour).center;
    let tl: Pt | null = null;
    let tr: Pt | null = null;
    let bl: Pt | null = null;
    let br: Pt | null = null;
    let dTl = 0;
    let dTr = 0;
    let dBl = 0;
    let dBr = 0;
    const pts = contour.data32S as Int32Array;
    for (let i = 0; i < pts.length; i += 2) {
      const p: Pt = { x: pts[i], y: pts[i + 1] };
      const d = dist(p, center);
      if (p.x < center.x && p.y < center.y) {
        if (d > dTl) (tl = p), (dTl = d);
      } else if (p.x > center.x && p.y < center.y) {
        if (d > dTr) (tr = p), (dTr = d);
      } else if (p.x < center.x && p.y > center.y) {
        if (d > dBl) (bl = p), (dBl = d);
      } else if (p.x > center.x && p.y > center.y) {
        if (d > dBr) (br = p), (dBr = d);
      }
    }
    if (!tl || !tr || !bl || !br) return null;

    const outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
    const outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
    if (outW < 8 || outH < 8) return null;

    // Защита от ложных срабатываний: доля площади четырёхугольника в кадре
    // (формула шнурков) — слишком мало (мусор) или почти весь кадр (нет рамки).
    const quadArea =
      Math.abs(
        tl.x * tr.y - tr.x * tl.y +
          (tr.x * br.y - br.x * tr.y) +
          (br.x * bl.y - bl.x * br.y) +
          (bl.x * tl.y - tl.x * bl.y),
      ) / 2;
    const frac = quadArea / (image.width * image.height);
    if (frac < minFrac || frac > maxFrac) return null;

    // Запас по краям: расширяем четырёхугольник наружу от его центроида на
    // долю cropMargin (0 — ровно по найденным краям). Контур часто проходит
    // ЧУТЬ внутри листа — без запаса обрезка «съедает» текст у краёв.
    if (cropMargin > 0) {
      const cx = (tl.x + tr.x + bl.x + br.x) / 4;
      const cy = (tl.y + tr.y + bl.y + br.y) / 4;
      const k = 1 + Math.min(0.2, Math.max(0, cropMargin));
      const expand = (p: Pt): Pt => ({
        x: Math.min(image.width - 1, Math.max(0, cx + (p.x - cx) * k)),
        y: Math.min(image.height - 1, Math.max(0, cy + (p.y - cy) * k)),
      });
      tl = expand(tl);
      tr = expand(tr);
      bl = expand(bl);
      br = expand(br);
    }
    const finW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
    const finH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y, tr.x, tr.y, bl.x, bl.y, br.x, br.y,
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, finW, 0, 0, finH, finW, finH,
    ]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    warped = new cv.Mat();
    cv.warpPerspective(
      src,
      warped,
      M,
      new cv.Size(finW, finH),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );
    srcTri.delete();
    dstTri.delete();
    M.delete();

    // Mat RGBA → ImageData (копия: буфер Mat живёт в wasm-куче).
    return new ImageData(new Uint8ClampedArray(warped.data), warped.cols, warped.rows);
  } finally {
    src.delete();
    gray.delete();
    blur.delete();
    thresh.delete();
    contours.delete();
    hierarchy.delete();
    contour?.delete?.();
    warped?.delete?.();
  }
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, image, minFrac, maxFrac, cropMargin } = ev.data as {
    id: number;
    image: ImageData;
    minFrac: number;
    maxFrac: number;
    cropMargin: number;
  };
  try {
    const { mod: cv } = await loadCv();
    const out = detectAndWarp(cv, image, minFrac, maxFrac, cropMargin ?? 0);
    if (out) {
      (self as any).postMessage({ id, ok: true, image: out }, [out.data.buffer]);
    } else {
      (self as any).postMessage({ id, ok: true, image: null });
    }
  } catch (e) {
    (self as any).postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
