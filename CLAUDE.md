# CLAUDE.md — школьная читалка (cross-OS)

Этот файл авто-загружается Claude Code в ЛЮБОЙ ОС при работе в этом репозитории.
Он — точка входа для кросс-ОС преемственности (Windows ↔ Kubuntu). Личная
авто-память (`~/.claude/.../memory`) НЕ переносится между ОС: она привязана к пути
проекта и своя на каждой машине. Поэтому состояние проекта живёт В РЕПО.

## ⚠️ Правило преемственности (читать первым делом)

1. В начале сессии прочитай **`PROJECT_STATE.md`** — это живой журнал: что сделано,
   что в разработке, как продолжать, кросс-ОС нюансы.
2. По ходу работы **дополняй `PROJECT_STATE.md`** (не переписывай — добавляй записи
   с датой). Обе ОС пишут в один файл. Коммить изменения, чтобы другая ОС подтянула
   через `git pull`.
3. Источник истины по требованиям — `chitalka_promt_i_tehplan.md` и
   `feature_skaner_knig.md`. **ВНИМАНИЕ:** ТЗ в `.gitignore` (приватное) → его НЕТ
   после свежего `git clone`. Перенеси файл вручную на новую ОС (флешка/scp), иначе
   потеряешь источник истины.

## Что за проект

Офлайн-первая читалка для школьников. Монорепо pnpm + Turborepo.
Стек: Svelte 5 + Vite (UI), foliate-js (форматы книг), IndexedDB+OPFS, Tauri 2
(десктоп + Android), Rust + axum (библиотечный сервер для класса/школы).

Пакеты: `packages/{core,reader-engine,ui,converters,network,adapters,book-scanner}`.
Приложения: `apps/{web,desktop,mobile,server}`.

## Кросс-ОС: пути, тулчейн, окружение

| | Windows (текущая) | Kubuntu |
|---|---|---|
| Корень проекта | `C:\ai_dev\school_book` | где склонирован (запускать Claude ИМЕННО там) |
| Node | v22.21.0 | поставить тот же мажор (nvm) |
| pnpm | 10.20.0 | `corepack enable` или npm i -g pnpm@10 |
| Rust | 1.93.x | rustup, та же ветка |
| Android SDK | `C:\Users\igadzhi\AppData\Local\Android\Sdk` | `~/Android/Sdk`, выставить `ANDROID_HOME`/`NDK_HOME` |
| JDK | `C:\Program Files\Java\jdk-21` | jdk-21 пакетом, `JAVA_HOME` |
| Shell | PowerShell | bash |

После клона на Kubuntu: `pnpm install`, `rustup target add` для Android-таргетов
(если собирать мобилку). Lock-файлы (`pnpm-lock.yaml`, `Cargo.lock`) — в репо, не
бампать без нужды, чтобы версии не разъехались между ОС.

> **⚠️ Kubuntu + NTFS-раздел (важно, читать перед `pnpm install`):** если репо лежит
> на NTFS-разделе Windows (ntfs3), **`pnpm install` там ЗАВИСАЕТ** на линковке
> node_modules (дедлок; проверено 2026-07-01). Rust/`cargo check` на ntfs3 при этом
> работает. Решение: **JS-разработка идёт из ext4-копии `~/school_book`** (полный rsync
> репо на ext4), а git/сервер/данные — в NTFS-папке. Синк — через git (`origin` GitHub +
> локальный remote `ntfs`). Подробности и раскладка — в `PROJECT_STATE.md` (запись
> 2026-07-01). Тулчейн Kubuntu уже поставлен: Node 22.21.0 (nvm), pnpm 10.20.0, Rust
> 1.96.1, JDK-21 (`~/Android/jdk-*`), Android SDK/NDK (`~/Android/Sdk`) — env в
> `~/.zshrc`/`~/.bashrc`.

## Рабочие правила (важно)

- **Билды — только по явной просьбе.** Не запускать `tauri android build`/release/
  инсталляторы/обновление `dist/` после каждого правка. Накапливать, собирать пакетом
  по команде «собери билд». Лёгкие проверки гонять свободно.
- **Лёгкие проверки** (skill `dev-checks`): `svelte-check`, `cargo check`,
  `tsc --noEmit` (network), vitest. Гонять перед «готово».
- **Аддитивность:** готовое не переписывать, доки/комменты на русском.
- **Не трогать данные сервера:** `apps/server/{data,library,rt_lib}/`, `*.db`,
  `dist/server/{chitalka.db,library}` — реальные книги/аккаунты владельца.
- Сервер: ключевой env `CHITALKA_WEB` (папка `apps/web/dist`) чтобы отдавать UI;
  `CHITALKA_LIBRARY/DB/TOKEN/NAME/PORT`. Подробности — `apps/server/README.md`.

Полная история и текущий фронт работ — в **`PROJECT_STATE.md`**.
