# PROJECT_STATE.md — живой журнал состояния

> Кросс-ОС файл преемственности. Обе ОС (Windows и Kubuntu) читают и **дополняют**
> его. Добавляй записи с датой в конец раздела «Журнал», не переписывай старое.
> Источник истины по требованиям — `chitalka_promt_i_tehplan.md` (в .gitignore!,
> перенести вручную) и `feature_skaner_knig.md`. Сводка стека — `CLAUDE.md`.

Последнее обновление: 2026-07-01 (Kubuntu).

---

## Краткий статус по фазам ТЗ (раздел 2.5)

- **Фаза 0 — фундамент / web PWA — ГОТОВА.** Монорепо pnpm+turbo; core/reader-engine/
  ui; `apps/web`: открытие EPUB/FB2/PDF (+MOBI/AZW3/CBZ), типографика, темы
  (светлая/тёмная/сепия/контраст), IndexedDB+OPFS, оглавление, прогресс/восстановление
  позиции, Service Worker.
- **Фаза 1 — оболочки — ГОТОВА.** `apps/desktop` (Tauri 2, тонкая оболочка над web-
  сборкой). `apps/mobile` (Tauri 2 Android) — **собрана, запущена и проверена на
  эмуляторе gg1**, подключается к серверу. Нативный TTS-адаптер (крейт `tts`) готов
  на desktop+mobile (рантайм на устройстве не гонялся, graceful→web). iOS не делался
  (нужен macOS/Xcode).
- **Фаза 2 — конвертация — ЗАКРЫТА.** `packages/converters`: HTML/MD/TXT/DOCX(mammoth)/
  RTF/ODT→EPUB, PDF→текст (вендорённый pdf.js), OCR (Tesseract.js v7, rus+eng),
  searchable PDF (pdf-lib), reflowable EPUB из OCR.
- **Фаза 2.5 — книга из фото (сканер) — ЗАКРЫТА.** `packages/{adapters,book-scanner}`:
  захват камерой (web getUserMedia), авто-обрезка/перспектива (OpenCV.js+jscanify),
  сборка CBZ/searchable-PDF/OCR-EPUB, LLM-постобработка OCR.
- **Фаза 3 — школьные фичи — ЗАКРЫТА (web).** TTS+подсветка слова, словарь по тапу,
  «Мои слова»+карточки (SM-2 lite), дислексия (OpenDyslexic+линейка чтения), LLM-
  помощник «объясни просто/кратко» (Ollama/LM Studio), экспорт слов (MD/CSV), оценка
  читаемости, геймификация (серия чтения, выкл по умолчанию), отчёт учитель/родитель,
  e-ink режим, формулы KaTeX.
- **Часть 5 / классификация — ЗАКРЫТА.** Теги многие-ко-многим (категории/классы/
  предметы), таксономия ФГОС, фасетный фильтр+умные полки, авторазметка (эвристики +
  метаданные книги + LLM Ollama/LM Studio), UI-подтверждение импорта.
- **Фаза 5 — клиент-сервер — ЗАКРЫТА (базовая).** `packages/network` (OPDS/sync/
  discovery/client/ws) + `apps/server` Rust axum: REST, OPDS-навигация по измерениям,
  Range-раздача, SQLite-каталог, метаданные+обложки, серверный автотег, синк прогресса
  и «Моих слов» (LWW+тумбстоуны), WebSocket realtime «продолжить везде», mDNS-анонс+
  поиск (Tauri), Docker. Web-UI: пэйринг/каталог/скачивание/синк/обложки.

## 🔨 ТЕКУЩИЙ ФРОНТ — Часть 6: аккаунты, доступ по классам, публикация (В РАЗРАБОТКЕ)

Сервер вырос за рамки старой памяти. Свежие коммиты (см. `git log`):
- `4103aac` статус книги на сервере «✓ На сервере» вместо вечного «Обновить».
- `eb243dd` доступ к книгам по классам + публикация книг с главной + фиксы мобилки.
- `2354bed` загрузка книг на сервер (большие файлы + кнопка на главной).
- `b478a4a` авто-логаут при 401 (протухший токен) + бейдж новых заявок.
- `6a15a5e` встроенный сервер в GUI, управление пользователями, поиск книг.

Что уже есть в сервере (`apps/server/src/`):
- `auth.rs` — argon2id хэш паролей + JWT (секрет персистентный в db meta, TTL 30 дней),
  роли (`models::Role`). ТЗ Часть 6 п.6.2.
- Управление пользователями, заявки на доступ (бейдж новых заявок), авто-логаут 401.
- Загрузка книг на сервер: сохраняются в `<library>/uploads/<uuid>_<имя>`
  (локально dev-папка — `apps/server/rt_lib/uploads/`). Публикация с главной страницы.
- Доступ к книгам ограничен по классам пользователя.
- `CHITALKA_WEB` — папка `apps/web/dist`, чтобы сервер сам отдавал web-UI (встроенный
  сервер в десктоп-GUI).

**TODO / возможные следующие шаги** (свериться с ТЗ Часть 6 перед работой):
- Доработки ролей/прав (учитель/ученик/админ), модерация заявок.
- Привязка синка прогресса/слов к аккаунту (а не только deviceId).
- Проверить мобилку с новым auth-флоу (вход, протухание токена).

## Как продолжать (чек-лист новой сессии)

1. Прочитать этот файл + при наличии `chitalka_promt_i_tehplan.md` сверить с ТЗ.
2. `git pull` (подтянуть правки с другой ОС). `pnpm install` если менялись зависимости.
3. Перед «готово» — лёгкие проверки: `pnpm -w` svelte-check, `cargo check` в
   `apps/server` и tauri-крейтах, network `tsc --noEmit`, vitest. (skill `dev-checks`).
4. Билды — ТОЛЬКО по явной просьбе («собери билд»). См. `CLAUDE.md`.
5. Дополнить этот файл записью в «Журнал» и закоммитить.

## Команды

- Web dev: `pnpm web:dev` (порт 5173). Сборка: `pnpm web:build`.
- Сервер: `cargo run` из `apps/server` или `pnpm --filter @reader/server dev`.
  Env: `CHITALKA_WEB`/`LIBRARY`/`DB`/`TOKEN`/`NAME`/`PORT`. Подробно — README сервера.
- Desktop: `pnpm --filter @reader/desktop dev|build`.
- Mobile (Android): см. `apps/mobile/README.md` + skill `build-android`.

## Кросс-ОС нюансы и подводные камни

- **Авто-память Claude не переносится** между ОС → весь статус держим здесь, в репо.
- **ТЗ не в git** (`chitalka_promt_i_tehplan.md`, `feature_skaner_knig.md` —
  последний В git, первый НЕТ). Перенести ТЗ вручную на Kubuntu.
- **Данные сервера локальные** и в .gitignore: `apps/server/{data,library,rt_lib}/`,
  `*.db`, `dist/`. Не появятся после клона — это нормально (реальные книги/аккаунты).
- **Локальные правки `apps/mobile/src-tauri/gen/android/`** gitignored, теряются при
  `tauri android init` → переприменять (MainActivity.kt без edgeToEdge,
  AndroidManifest `allowBackup="false"`). Детали — skill `deliver-dist`.
- Android-эмулятор видит хост-сервер по `10.0.2.2:9700`; mDNS в эмуляторе не работает.
- Не запускать два `pnpm --filter @reader/web build` параллельно (десктоп и APK оба
  пишут в `apps/web/dist`).
- Skills проекта (в `.claude/skills/`, gitignored → нет на Kubuntu): `dev-checks`,
  `run-server`, `build-android`, `emulator-test`, `deliver-dist`. При нужде на Kubuntu
  пересоздать или работать без них (команды продублированы выше).

---

## Журнал (добавлять записи с датой; новые — вниз)

- **2026-06-30 (Windows):** создан этот файл + `CLAUDE.md` для кросс-ОС
  преемственности (готовимся запускать проект из Kubuntu). Зафиксировано: ветка
  `master`, текущий фронт — Часть 6 (аккаунты/доступ по классам/публикация/загрузка
  на сервер). `apps/server/rt_lib/` добавлен в .gitignore как рантайм-данные.
- **2026-07-01 (Kubuntu):** первый запуск из Kubuntu. Раскладка дисков: Linux `/` на
  `nvme1n1` (LUKS-ext4 `kubuntu_2604`); проект — на `nvme0n1p3` **NTFS** (это диск
  Windows, рядом BitLocker/EFI). Правило: **ничего разрушительного на nvme0n1 не
  делать**, весь тулчейн ставить в `$HOME` (ext4). Установлено под Linux:
  **pnpm 10.20.0** (через corepack, node остаётся v20.20.2 — в nvm ещё есть v26.3.0;
  Windows был на v22.21.0, engines не заданы, для Vite/Svelte 5 v20 LTS ок),
  **Rust 1.96.1** (rustup в `~/.cargo`/`~/.rustup`, `. "$HOME/.cargo/env"` прописан в
  `~/.zshrc` и `~/.bashrc`). C-тулчейн уже был: gcc 15, build-essential, pkg-config,
  make, curl. НЕ ставилось (только для APK): JDK-21 (в системе Java 25), Android SDK/NDK.
  НЕ выполнялось: `pnpm install` (перезапишет node_modules с Windows-бинарями на NTFS —
  ждём явной команды), `cargo check` (тяжёлая компиляция + пишет в target/ на NTFS).
  **Сверка ТЗ Часть 6:** по ТЗ (`chitalka_promt_i_tehplan.md`, п.6.6) все модули 1–9 +
  хвост отмечены `[x]`, «полностью реализована (2026-06-21)». Код сервера это
  подтверждает (grep: assignments/jwt/bookmarks/audit/highlights/register/argon2/backup/
  /me//login присутствуют). Т.е. по букве ТЗ Часть 6 закрыта; открытые пункты в блоке
  «TODO» выше — это возможные доработки СВЕРХ ТЗ (роли/права тонко, синк по аккаунту
  вместо deviceId, проверка мобилки с auth-флоу), а не невыполненные требования.
- **2026-07-01 (Kubuntu), продолжение — тулчейн доустановлен + ⚠️ важный вывод по NTFS:**
  Доустановлено под Linux (всё в `$HOME`/ext4): **Node 22.21.0** (nvm default, pnpm
  переактивирован через corepack), **rustup android-таргеты** (aarch64/armv7/i686/
  x86_64-linux-android), **JDK-21** Temurin 21.0.11 → `~/Android/jdk-21.0.11+10`,
  **Android SDK** → `~/Android/Sdk` (platform-36, build-tools 36.0.0, platform-tools
  adb 1.0.41, **NDK r28c 28.2.13676358**; проект хочет compileSdk/targetSdk 36, minSdk 24).
  Env прописан в `~/.zshrc`+`~/.bashrc`: `JAVA_HOME`(→JDK-21), `ANDROID_HOME`,
  `ANDROID_SDK_ROOT`, `NDK_HOME`, PATH(cmdline-tools+platform-tools). Команда `java`
  осознанно НЕ перекрыта глобально (остаётся системная 25; gradle/AGP берёт JAVA_HOME).
  - **⚠️ NTFS/ntfs3 — pnpm install НЕ РАБОТАЕТ в папке проекта.** Раздел смонтирован
    `ntfs3` (kernel-драйвер, `uid/gid=1000,acl,prealloc`). `pnpm install` стабильно
    **дедлочится на фазе линковки node_modules** (потоки в futex/ep_poll, 0% CPU,
    0 записей минутами — это не «медленно», а зависание). Проверено на всех вариантах:
    isolated/hoisted, hardlink/copy, store на ntfs3 и на ext4. При этом одиночные
    `ln -s`/`ln` на ntfs3 работают мгновенно, а `cargo check` сервера на ntfs3 —
    **проходит (exit 0)**. Т.е. Rust на ntfs3 ок; проблема узко в bulk-создании
    node_modules (много тысяч мелких файлов/симлинков конкурентно) на ntfs3.
    Симлинк node_modules→ext4 не помогает: pnpm сам управляет жизненным циклом
    node_modules и ломает/удаляет таргет (isolated → ENOTDIR, hoisted → рвётся).
    На чистом **ext4 всё ставится за 1.4с** и работает идеально (esbuild postinstall Done).
    ⇒ **Для JS-разработки на Kubuntu node_modules должен жить на ext4, не на этом NTFS.**
    Варианты (решить с владельцем): (a) держать рабочую JS-копию репо на ext4 (git/сервер
    можно оставить на NTFS); (b) bind-mount ext4→`node_modules` через fstab (нужен sudo);
    (c) тюнинг монтирования/ntfs-3g. Глобальный конфиг pnpm откатан к дефолту (воркэраунд
    hoisted/copy на ntfs3 всё равно не спасал, а на ext4 он ломал esbuild).
  - **Проверки (dev-checks) — ВСЕ ЗЕЛЁНЫЕ** (JS-часть прогнана в ext4-зеркале `~/sb_check`,
    исходники те же; Rust — на реальном дереве):
    web `svelte-check` 565 файлов **0 ERRORS 0 WARNINGS**; `@reader/network` `tsc --noEmit`
    **0 ошибок**; `vitest` **19/19 passed** (network sync, core readability/bookmarks/autotag);
    `cargo check` сервера **exit 0**. Замечание: build-scripts `canvas`/`tesseract.js`
    (OCR) остаются ignored у pnpm — для type-check/тестов не нужны, для реального
    OCR-рантайма позже `pnpm approve-builds`.
  - Состояние реальной папки на NTFS: **node_modules сейчас НЕТ** (повисшие симлинки
    убраны). Ставить его туда бессмысленно до решения по варианту (a/b/c). `~/sb_check` —
    рабочее ext4-зеркало для JS-проверок (можно удалить/пересоздать rsync'ом).
  - **РЕШЕНО (владелец выбрал вариант «a»):** рабочая JS-копия репо живёт на **ext4 в
    `~/school_book`** (полный rsync с NTFS: код+`.git`+ТЗ+`.claude`, без node_modules/
    target/dist/данных сервера). Там `pnpm install` (isolated) встаёт за ~1с, все
    проверки зелёные. Синк с NTFS — через git (`origin` = github.com/Gadzhik/school-book,
    плюс локальный remote `ntfs` → путь на NTFS-разделе). Временный `~/sb_check` удалён.
    **Рабочий процесс на Kubuntu:** JS/сборки/pnpm — в `~/school_book` (ext4); git,
    Rust-сервер и реальные данные сервера — в NTFS-папке (там cargo работает). Коммитить
    из одной копии и подтягивать в другую через `git pull`. NTFS-папку под JS НЕ
    поднимать (pnpm install там виснет).
  - **Синхронизация двух копий — скрипт `~/sb-sync`** (лежит в `$HOME`, вне репо;
    Kubuntu-локальный). Одна команда синкает ОБЕ копии: пушит новые коммиты каждой в
    `origin` (GitHub, SSH), подтягивает обе `--ff-only`, и односторонним rsync переносит
    приватные gitignore-файлы (ТЗ `chitalka_promt_i_tehplan.md`, `.claude/`) с NTFS→ext4.
    `push`/`merge --ff-only` НЕ сканируют всё дерево, поэтому не виснут на ntfs3 (а вот
    `git status`/`git add -A` на ntfs3 — очень медленные, вплоть до таймаута). **Правило:
    закоммить правки в той копии, где работал, потом `~/sb-sync`.** Если копии
    редактировали обе без синка (ветки разошлись) — скрипт честно скажет «не ff, вручную».
    Git-настройка: у обеих копий `origin` = `git@github.com:Gadzhik/school-book.git` (SSH),
    в каждом репо `core.sshCommand` с явным ключом (ssh-agent на этой машине отказывался
    подписывать); плюс прямые локальные remotes `ntfs`↔`ext4` для синка без GitHub.
