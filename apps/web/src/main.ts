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
