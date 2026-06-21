# Мобильная оболочка (Tauri 2 mobile)

iOS/Android из той же web-сборки читалки. Ядро (`packages/*`) не меняется —
оболочка только оборачивает UI в системный WebView. Хранилище IndexedDB/OPFS
работает в WebView; нативные камера и TTS подключаются плагинами Tauri.

## Что уже есть

- `src-tauri/` — Rust-крейт оболочки (`reader_mobile_lib`), `tauri.conf.json`
  (грузит `../../web/dist`, dev — `http://localhost:5173`), иконки.
- `cargo check` проходит (логика компилируется).

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

# iOS (macOS)
pnpm --filter @reader/mobile ios:init
pnpm --filter @reader/mobile ios:dev
```

`*:init` создаёт нативный проект в `src-tauri/gen/` (в .gitignore).

## Дальше (нативные адаптеры)

Камера и TTS на мобилке — через `packages/adapters`: заменить web-реализацию
нативным плагином Tauri (`setCamera(...)`, TTS-адаптер), не трогая UI и ядро.
