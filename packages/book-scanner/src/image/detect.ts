/**
 * Stage B: авто-поиск листа в кадре + коррекция перспективы (выправление
 * перекоса фото под углом). Вся тяжёлая работа (OpenCV.js ~10МБ wasm,
 * Canny/contours/warp) выполняется в WEB WORKER — см. detect.worker.ts.
 *
 * Раньше OpenCV компилировался и считал в главном потоке: вкладка замирала
 * на секунды при каждом фото (и на десятки секунд на первой — инициализация
 * wasm). Теперь главный поток только декодирует фото в ImageData и кодирует
 * результат в JPEG; UI остаётся живым.
 *
 * Если лист не найден / результат подозрительный / воркер недоступен —
 * возвращаем null, и вызывающий код оставляет исходный кадр (обрезка —
 * «магия», не обязаловка).
 */

/** Доля кадра, которую должен занимать найденный лист (защита от ложняков). */
const MIN_FRAC = 0.2;
const MAX_FRAC = 0.985;
/** Максимум ожидания одного кадра (вкл. первую инициализацию OpenCV). */
const JOB_TIMEOUT_MS = 45000;

interface Job {
  resolve: (img: ImageData | null) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let seq = 0;
const jobs = new Map<number, Job>();

function failAll(err: Error): void {
  for (const [, job] of jobs) {
    clearTimeout(job.timer);
    job.reject(err);
  }
  jobs.clear();
}

/** Ленивый singleton-воркер детекции. null — Worker недоступен (SSR/старьё). */
function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./detect.worker.ts', import.meta.url));
  } catch {
    return null;
  }
  worker.onmessage = (ev: MessageEvent) => {
    const { id, ok, image, error } = ev.data as {
      id: number;
      ok: boolean;
      image: ImageData | null;
      error?: string;
    };
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    clearTimeout(job.timer);
    if (ok) job.resolve(image);
    else job.reject(new Error(error ?? 'Ошибка авто-обрезки'));
  };
  worker.onerror = () => {
    failAll(new Error('Воркер авто-обрезки упал'));
    worker?.terminate();
    worker = null; // следующий вызов создаст заново
  };
  return worker;
}

/** Прогнать кадр через воркер (с таймаутом; при зависании воркер пересоздаётся). */
function runDetect(image: ImageData): Promise<ImageData | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise<ImageData | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      jobs.delete(id);
      // Завис (кривая инициализация wasm и т.п.) — убиваем, дальше без обрезки.
      failAll(new Error('Авто-обрезка не ответила вовремя'));
      worker?.terminate();
      worker = null;
      resolve(null);
    }, JOB_TIMEOUT_MS);
    jobs.set(id, { resolve, reject, timer });
    w.postMessage({ id, image, minFrac: MIN_FRAC, maxFrac: MAX_FRAC }, [image.data.buffer]);
  });
}

/** Загрузить blob в ImageData, уменьшив длинную сторону до maxSide. */
async function blobToImageData(blob: Blob, maxSide: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas 2D-контекст недоступен');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = ctx.getImageData(0, 0, w, h);
  canvas.width = 0;
  canvas.height = 0;
  return data;
}

/** Закодировать ImageData в JPEG-Blob. */
async function imageDataToBlob(image: ImageData, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D-контекст недоступен');
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Не удалось закодировать JPEG'))),
      'image/jpeg',
      quality,
    );
  });
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/**
 * Найти лист и выправить перспективу. Возвращает обрезанный JPEG-Blob, либо
 * null если лист не обнаружен / результат неправдоподобен / воркер недоступен
 * (тогда вызывающий оставляет исходник).
 *
 * Работаем на уменьшенной копии (контроль памяти, ТЗ фичи); итог тоже ≤maxSide.
 */
export async function detectAndCrop(
  blob: Blob,
  maxSide = 2000,
  quality = 0.85,
): Promise<Blob | null> {
  try {
    const image = await blobToImageData(blob, maxSide);
    const warped = await runDetect(image);
    if (!warped) return null;
    return await imageDataToBlob(warped, quality);
  } catch {
    return null; // любая ошибка детекции — мягкий откат к исходнику
  }
}

/** Доступна ли авто-обрезка в текущей среде (нужен браузер с canvas+Worker). */
export function autoCropSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof Worker !== 'undefined'
  );
}
