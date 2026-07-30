/**
 * Точка входа PWA: монтирование приложения, загрузка настроек,
 * запрос постоянного хранилища, регистрация Service Worker.
 */
import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage, seedTaxonomy, initLogging, log } from '@reader/core';
import {
  initSettings,
  refreshLibrary,
  applyAppTheme,
  settings,
  initHistoryNavigation,
  initLogSync,
} from '@reader/ui';
import { get } from 'svelte/store';
import App from './App.svelte';
import './app.css';

// Полифилл Array.prototype.at для старых Android System WebView (Chrome <92):
// его использует foliate-js при разборе CFI — без него не работают выделения,
// заметки учителя и переходы по закладкам («parts?.at is not a function»).
if (!Array.prototype.at) {
  // eslint-disable-next-line no-extend-native
  Object.defineProperty(Array.prototype, 'at', {
    value: function at(this: unknown[], n: number) {
      const len = this.length;
      let i = Math.trunc(n) || 0;
      if (i < 0) i += len;
      return i < 0 || i >= len ? undefined : this[i];
    },
    writable: true,
    configurable: true,
  });
}

// Полифиллы современных методов для старых Android System WebView.
// Вендорённый pdf.js собран под свежий движок и без них ЛЮБОЙ PDF не
// открывается вовсе (ноль отрисованных страниц). Поймано журналом на
// эмуляторе с WebView 124 (2026-07-30); на школьных телефонах со старым
// WebView будет то же самое.
//   Promise.try                  — Chrome 128 (pdf.mjs и pdf.worker.mjs)
//   Promise.withResolvers        — Chrome 119
//   Uint8Array.prototype.toHex   — Chrome 140 (pdf.worker.mjs)
//   Uint8Array.prototype.toBase64 / Uint8Array.fromBase64 — Chrome 140
// Тот же набор продублирован в начале `pdf.worker.mjs`: настоящий воркер —
// отдельный контекст, полифиллы страницы туда не попадают.
installModernApiPolyfills();

function installModernApiPolyfills(): void {
  const def = (obj: object, name: string, value: unknown) => {
    if (typeof (obj as Record<string, unknown>)[name] !== 'function') {
      Object.defineProperty(obj, name, { value, writable: true, configurable: true });
    }
  };

  // fn зовётся синхронно, исключение становится отклонённым промисом.
  def(Promise, 'try', function pTry<T>(fn: (...a: unknown[]) => T, ...args: unknown[]) {
    return new Promise((resolve) => resolve(fn(...args) as Awaited<T>));
  });

  def(Promise, 'withResolvers', function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });

  const HEX = '0123456789abcdef';
  def(Uint8Array.prototype, 'toHex', function toHex(this: Uint8Array) {
    let out = '';
    for (const b of this) out += HEX[b >> 4] + HEX[b & 15];
    return out;
  });

  def(Uint8Array.prototype, 'toBase64', function toBase64(this: Uint8Array) {
    let bin = '';
    for (const b of this) bin += String.fromCharCode(b);
    return btoa(bin);
  });

  def(Uint8Array, 'fromBase64', function fromBase64(s: string) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  });

  // Map/WeakMap.getOrInsertComputed — самый свежий из набора (pdf.js зовёт его
  // 15 раз). Есть ключ — отдаём значение, нет — вычисляем колбэком и кладём.
  const getOrInsertComputed = function <K, V>(this: Map<K, V>, key: K, compute: (k: K) => V): V {
    if (this.has(key)) return this.get(key) as V;
    const value = compute(key);
    this.set(key, value);
    return value;
  };
  def(Map.prototype, 'getOrInsertComputed', getOrInsertComputed);
  def(WeakMap.prototype, 'getOrInsertComputed', getOrInsertComputed);
}

// Журнал приложения — включаем ПЕРВЫМ делом, до любой другой инициализации:
// иначе падение на старте (миграция БД, отсутствие OPFS, битая настройка)
// не попадёт в журнал, а это как раз самые важные ошибки. Один и тот же код
// работает в вебе, в десктопной оболочке Tauri и в Android-WebView.
initLogging({
  appVersion: ((import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_APP_VERSION as string) || '0.0.0',
  // Уровень, выбранный в настройках (ключ пишет SettingsPanel). Читаем из
  // localStorage, а не из настроек в IndexedDB: журнал должен работать раньше,
  // чем откроется база — падения при её открытии тоже надо ловить.
  level: (() => {
    try {
      const v = localStorage.getItem('reader:logLevel');
      return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : undefined;
    } catch {
      return undefined;
    }
  })(),
});

async function bootstrap() {
  // Просим браузер не вытеснять данные (важно для iOS Safari).
  await requestPersistentStorage();

  // Загружаем сохранённые настройки и применяем тему до отрисовки.
  await initSettings();
  applyAppTheme(get(settings).theme);

  // Сидируем словари классификации (классы/предметы/категории) при первом запуске.
  await seedTaxonomy();

  // Загружаем список книг.
  await refreshLibrary();

  // Связываем навигацию с History API: аппаратная/жестовая «Назад» на Android
  // (и кнопка назад браузера) ходит внутри приложения, а не сворачивает его.
  initHistoryNavigation();

  // Фоновая досылка журнала на школьный сервер (если подключён) + перенос
  // нативного журнала оболочки Tauri (паники Rust) в общий.
  initLogSync();

  mount(App, { target: document.getElementById('app')! });
  log.info('app', 'приложение смонтировано');
}

void bootstrap().catch((e) => {
  // Старт не должен падать молча: без этого экран остаётся пустым, а причина
  // видна только в консоли, до которой на телефоне не добраться.
  log.error('app', 'не удалось запустить приложение', e);
});

// Автообновление Service Worker (только в прод-сборке).
registerSW({ immediate: true });
