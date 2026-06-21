# Мобильная оболочка (Tauri 2 mobile)

iOS/Android из той же web-сборки читалки. Ядро (`packages/*`) не меняется —
оболочка только оборачивает UI в системный WebView. Хранилище IndexedDB/OPFS
работает в WebView; нативные камера и TTS подключаются плагинами Tauri.

## Что уже есть

- `src-tauri/` — Rust-крейт оболочки (`reader_mobile_lib`), `tauri.conf.json`
  (грузит `../../web/dist`, dev — `http://localhost:5173`), иконки (вкл. `icon.icns`).
- Точка входа `#[cfg_attr(mobile, tauri::mobile_entry_point)]` — общая для Android и **iOS**.
- `tauri.conf.json`: `identifier = app.reader.school` (валидный iOS bundle id),
  `bundle.iOS.minimumSystemVersion = 13.0`.
- Скрипты `ios:init|dev|build` в `package.json`.
- **Android собран и проверен на эмуляторе** (подключается к серверу, UI рендерится нативно).
- **iOS — код и конфиг готовы; не собран**, т.к. генерация Xcode-проекта
  (`tauri ios init`) и сборка `.ipa` выполняются **только на macOS + Xcode**
  (тулчейн Apple недоступен на Windows). На Mac — это команды ниже, без правок кода.

## Пререквизиты сборки на устройство

Полноценная сборка `tauri android|ios` требует платформенный тулчейн (его нельзя
поднять «вслепую» — нужен установленный SDK):

**Android:**
- Android SDK + Platform-Tools (есть: `~/AppData/Local/Android/Sdk`)
- **Android NDK** (отдельно через SDK Manager) → переменная `NDK_HOME`
- JDK 17+ (есть JDK 21) — добавить `java` в `PATH`, задать `JAVA_HOME`
- Переменные окружения: `ANDROID_HOME` (на каталог SDK), `NDK_HOME`
- Rust-таргеты:
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```

**iOS (только на macOS):**
- Xcode + Command Line Tools
- Rust-таргеты:
  ```bash
  rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
  ```

## Команды

```bash
# Android (после установки NDK и переменных окружения)
pnpm --filter @reader/mobile android:init
pnpm --filter @reader/mobile android:dev      # запуск на эмуляторе/устройстве

# iOS (только на macOS + Xcode)
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
pnpm --filter @reader/mobile ios:init      # генерит src-tauri/gen/apple (Xcode-проект)
pnpm --filter @reader/mobile ios:dev       # запуск в симуляторе/на устройстве
pnpm --filter @reader/mobile ios:build     # сборка .ipa (release)
```

Подпись и установка на реальное устройство / App Store требуют аккаунт Apple
Developer: задать команду подписи через `export APPLE_DEVELOPMENT_TEAM=<TeamID>`
(или открыть `src-tauri/gen/apple` в Xcode и выбрать Team в Signing & Capabilities).

`*:init` создаёт нативный проект в `src-tauri/gen/` (в .gitignore).

## Дальше (нативные адаптеры)

Камера и TTS на мобилке — через `packages/adapters`: заменить web-реализацию
нативным плагином Tauri (`setCamera(...)`, TTS-адаптер), не трогая UI и ядро.
