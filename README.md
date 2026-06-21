# Универсальная читалка-конвертер для школьников

Офлайн-первое приватное приложение для чтения электронных книг. Единое
веб-ядро + тонкие платформенные оболочки (PWA → десктоп Tauri 2 → мобилки
Tauri 2 mobile). Все данные хранятся только на устройстве: ни телеметрии,
ни облака, ни обязательной регистрации.

Источник истины по архитектуре — `chitalka_promt_i_tehplan.md`.

## Структура монорепо

```
packages/
  core/          # бизнес-логика без UI: модель документа, библиотека, хранилище, настройки
  reader-engine/ # обёртка над foliate-js (+ его pdf.js): рендер, пагинация, TOC, прогресс
  ui/            # общие Svelte-компоненты, темы, сторы состояния
apps/
  web/           # PWA: Vite + Service Worker + manifest  (Фаза 0)
  desktop/       # Tauri 2  (Фаза 1)
  mobile/        # Tauri 2 mobile  (Фаза 1)
assets/
  dictionaries/  # офлайн-словари (ru), шрифты (OpenDyslexic) — Фаза 3
```

## Технологии

- **UI:** Svelte 5 + Vite
- **Движок чтения:** [foliate-js](https://github.com/johnfactotum/foliate-js) (EPUB/FB2/MOBI/AZW3/CBZ) + встроенный pdf.js (PDF)
- **Хранилище:** IndexedDB + OPFS (через `idb`)
- **Монорепо:** pnpm workspaces + Turborepo

## Что готово (Фаза 0)

- PWA-каркас, тёмная/светлая/сепия/контрастная темы.
- Открытие **EPUB / FB2 / FB2.zip / PDF** (а также MOBI/AZW3/CBZ — бонусом от foliate-js).
- Определение формата по сигнатуре файла, а не по расширению.
- Типографика: размер шрифта, межстрочный интервал, поля, выравнивание, шрифт (засечки/без/дислексия).
- Библиотека в IndexedDB + OPFS, восстановление позиции чтения, прогресс.
- Постоянное хранилище (`navigator.storage.persist()`), оглавление, навигация.

## Запуск

```bash
pnpm install

# Разработка (http://localhost:5173)
pnpm web:dev

# Прод-сборка и предпросмотр (Service Worker активен только в проде)
pnpm web:build
pnpm web:preview
```

## Лицензии внешних компонентов

- **foliate-js** — MIT (вендорён в `packages/reader-engine/vendor/foliate-js`, включает сборку pdf.js — Apache-2.0).
- **idb** — ISC. **Svelte**, **Vite** — MIT.

Полный аудит лицензий перед релизом — см. раздел 2.7 ТЗ.
