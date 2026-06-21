/**
 * NODE-ONLY модуль. Абсолютный путь к вендорённому исходнику foliate-js.
 * Используется только сборщиком приложения (vite.config) для копирования
 * foliate-js в статику. НЕ импортировать в браузерный код — здесь node:* API.
 *
 * Браузеро-безопасную константу FOLIATE_PUBLIC_BASE см. в ./constants.ts.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Путь к каталогу vendor/foliate-js внутри пакета. */
export const foliateVendorDir = resolve(here, '..', 'vendor', 'foliate-js');

// Дублируем константу (а не импортируем из ./constants), т.к. этот файл
// грузится Vite-конфигом через нативный ESM, где относительные импорты без
// расширения не резолвятся. Браузерный код берёт её из ./constants.
export const FOLIATE_PUBLIC_BASE = '/foliate-js';
