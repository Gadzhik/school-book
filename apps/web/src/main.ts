/**
 * Точка входа PWA: монтирование приложения, загрузка настроек,
 * запрос постоянного хранилища, регистрация Service Worker.
 */
import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage, seedTaxonomy } from '@reader/core';
import {
  initSettings,
  refreshLibrary,
  applyAppTheme,
  settings,
  initHistoryNavigation,
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

  mount(App, { target: document.getElementById('app')! });
}

void bootstrap();

// Автообновление Service Worker (только в прод-сборке).
registerSW({ immediate: true });
