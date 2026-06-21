# @reader/server — библиотечный сервер (Фаза 5)

Rust + axum. Раздаёт общую библиотеку в локальной сети: OPDS-каталог,
скачивание книг с поддержкой Range, синхронизация прогресса и «Моих слов».
Совместим со сторонними читалками (Foliate/KOReader) через OPDS. ТЗ Часть 4.

## Запуск

```bash
cargo run            # из apps/server
# или
pnpm --filter @reader/server dev
```

Положите книги (EPUB/FB2/PDF/CBZ/MOBI/AZW3) в папку `./library` — при старте
сервер их проиндексирует (рекурсивно, идемпотентно).

## Конфигурация (переменные окружения)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `CHITALKA_LIBRARY` | `./library` | Папка с книгами |
| `CHITALKA_DB` | `./chitalka.db` | Файл SQLite-каталога |
| `CHITALKA_TOKEN` | — | Токен пэйринга; если задан — нужен `Authorization: Bearer <token>` (ТЗ 4.5) |
| `CHITALKA_NAME` | `Читалка` | Имя сервера (в /status и OPDS) |
| `CHITALKA_PORT` | авто | Порт. Если не задан — берётся первый свободный из 9700–9899 (если все заняты — эфемерный). Если задан — используется он (ошибка, если занят). |

Сервер слушает `0.0.0.0` — доступен одновременно по **LAN-IP** (для других
устройств) и по **localhost** (на этом компьютере). При старте печатает обе
ссылки; `GET /status` возвращает `address` (LAN-IP) и `port`.

CORS разрешён для любого origin — веб-клиент (PWA на другом порту) может
обращаться к серверу напрямую.

При старте сервер анонсирует себя в локальной сети через mDNS
(`_chitalka._tcp.local`) — нативные клиенты (Tauri) находят его сами.
Браузерный PWA mDNS не умеет: для него QR/ручной ввод адреса.

## Эндпоинты

- `GET /status` — JSON `{ name, version, books, ok, address, port }` (открыт, для пинга/обнаружения; `address` — LAN-IP, `port` — реально занятый).
- `GET /opds` — корневой OPDS-навигационный фид (по измерениям + все книги).
- `GET /opds/all` — acquisition-фид всех книг.
- `GET /opds/{classes|subjects|categories}` — навигация по измерению (значения с числом книг).
- `GET /opds/{class|subject|category}/{id}` — книги с данным тегом (автотег при сканировании).
- `GET /books/{id}/file` — файл книги с поддержкой Range (докачка/перемотка).
- `GET /books/{id}/cover?token=<token>` — обложка EPUB (PNG/JPEG). Токен в query (для `<img>`). 404 — если обложки нет.
- `GET /api/progress/{bookId}` — самый свежий прогресс по всем устройствам.
- `PUT /api/progress/{bookId}` — записать прогресс (LWW по `updatedAt`).
- `GET /api/words?since=<ms>` — слова, изменённые после метки (дельта).
- `POST /api/words` — принять пачку слов (LWW по `updatedAt`, тумбстоуны).
- `GET /ws?token=<token>` — WebSocket живой рассылки прогресса (другое устройство сдвинуло позицию → клиенты получают обновление). Токен в query.

### Аккаунты и роли (ТЗ Часть 6)

- `POST /api/register` — регистрация. Тело: `{ role: "teacher"|"student", fullName, login, password, subjects?, classes?, class? }`. **Первый зарегистрированный — администратор** (бутстрап, статус `active`); остальные — `teacher`/`student` со статусом `pending` (ждут одобрения). Ответ: `{ token, user }`. `409` — логин занят, `400` — пустые поля/короткий пароль.
- `POST /api/login` — вход. Тело: `{ login, password }`. Ответ: `{ token, user }`. `401` — неверные данные, `403` — заблокирован. Вход в статусе `pending` разрешён (клиент покажет «ждёт одобрения»); права — на защищённых роутах (модуль RBAC).
- `GET /api/me` — профиль текущего пользователя по `Authorization: Bearer <JWT>`. `401` — нет/невалидный токен.
- `GET /api/users` — пользователи для управления (по роли): админ/power — все; учитель — ученики своих классов; ученик — `403`. По JWT.
- `POST /api/users/{id}/approve` — одобрить (статус → `active`). RBAC: админ/power → учителей и учеников; учитель → учеников своих классов. Иначе `403`.
- `POST /api/users/{id}/reject` — отклонить/заблокировать (статус → `blocked`). Те же права.
- `POST /books` — загрузка книги (multipart: `file`, `title?`, `classes?`, `subjects?`, `categories?` — CSV). Права: admin/power/teacher (ученик — `403`). Учитель привязывает только к **своим** классам/предметам (остальное отбрасывается). Файл сохраняется в `library/uploads/`, индексируется в каталог. Ответ `201 { id }`.

### Задания и прогресс класса (ТЗ Часть 6, п.6.5)

- `POST /api/assignments` — создать задание `{ bookId, classId, title?, note?, dueAt? }`. Учитель — только свои классы; админ/power — любые. `201` с заданием. `403`/`404` — нет прав/книги.
- `GET /api/assignments` — список: ученику — по его классам с личным статусом (`AssignmentForStudent`); учителю — по его классам; админ/power — все.
- `DELETE /api/assignments/{id}` — удалить (создатель/админ/power).
- `POST /api/assignments/{id}/progress` — ученик отмечает `{ status: "reading"|"done", fraction? }`. Только ученик класса задания.
- `GET /api/assignments/{id}/report` — отчёт: ученики класса + статусы (`not_started`/`reading`/`done`). Учитель класса/админ/power.

### Синхронизация закладок и выделений (ТЗ Часть 6, п.6.3)

- `GET /api/bookmarks?since=<ms>` / `POST /api/bookmarks` — закладки **текущего пользователя** (по JWT), дельта по `since`, LWW по `updatedAt`, тумбстоуны. Между пользователями изолированы.
- `GET /api/highlights?since=<ms>` / `POST /api/highlights` — выделения/заметки текущего пользователя, аналогично.

### Аудит и резервная копия (ТЗ Часть 6, E8+E9)

- `GET /api/audit` — журнал действий (последние 300): кто/что/детали/время. Только admin/power. Логируются register/approve/reject/upload/assign/unassign/backup.
- `GET /api/backup` — скачать согласованную копию БД (SQLite, `VACUUM INTO`). Только admin. Восстановление: остановить сервер, заменить файл `CHITALKA_DB` этим файлом, запустить снова.

Пароли хранятся как **argon2-хэш**. JWT (HS256, TTL 30 дней) подписывается персистентным секретом из таблицы `meta` (генерируется при первом запуске). Роли: `admin`/`power`/`teacher`/`student`; статусы: `pending`/`active`/`blocked`.

Клиентская часть — `packages/network` (`LibraryServerClient`, OPDS-парсер,
модели синхронизации).

## Docker (ТЗ 4.6)

```bash
docker compose up -d        # из apps/server
```

Книги — в `./data/library`, БД — `./data/chitalka.db` (тома переживают
пересборку). Контейнер `chitalka_server`, порт 9700, `HEALTHCHECK` по
`/status`. Многоэтапная сборка (Rust → debian-slim).

mDNS не проходит через bridge-сеть Docker: для автообнаружения нативными
клиентами включите host-сеть на Linux (см. комментарий в `docker-compose.yml`).

## TODO следующих модулей Фазы 5

- mDNS-анонс сервиса `_chitalka._tcp.local` (crate `mdns-sd`).
- WebSocket «продолжить на любом устройстве» в реальном времени.
- Docker-сборка (`chitalka_*`, порты 9700–9899, тома, healthcheck).
- Метаданные книг (точные title/author/обложка) и OPDS-навигация по классам/предметам (ТЗ 5.6).
