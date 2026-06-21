/**
 * Точка входа PWA: монтирование приложения, загрузка настроек,
 * запрос постоянного хранилища, регистрация Service Worker.
 */
import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistentStorage, seedTaxonomy } from '@reader/core';
import { initSettings, refreshLibrary, applyAppTheme, settings } from '@reader/ui';
import { get } from 'svelte/store';
import App from './App.svelte';
import './app.css';

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

  mount(App, { target: document.getElementById('app')! });
}

void bootstrap();

// Автообновление Service Worker (только в прод-сборке).
registerSW({ immediate: true });
