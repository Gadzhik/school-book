//! Библиотечный сервер читалки (Фаза 5, ТЗ Часть 4).
//! REST + OPDS-каталог + раздача книг с поддержкой Range, каталог в SQLite.
//!
//! Крейт даёт и библиотеку (встраивание в десктоп: [`start`]/[`ServerHandle`]),
//! и бинарь (`src/main.rs`). Конфигурация — через [`Config`] (десктоп задаёт
//! поля напрямую) или [`Config::from_env`] (бинарь, переменные окружения):
//!   CHITALKA_LIBRARY — папка с книгами (по умолчанию ./library)
//!   CHITALKA_DB      — файл БД (по умолчанию ./chitalka.db)
//!   CHITALKA_TOKEN   — токен пэйринга; если задан — требуется Bearer (ТЗ 4.5)
//!   CHITALKA_NAME    — имя сервера (для /status и OPDS)
//!   CHITALKA_PORT    — порт (по умолчанию 9700, диапазон ТЗ 9700–9899)
//!   CHITALKA_WEB     — папка веб-сборки (apps/web/dist) для раздачи UI
//!   CHITALKA_UPDATES — папка обновлений приложения (manifest.json + APK/инсталляторы)
//!   CHITALKA_ADMIN_LOGIN / CHITALKA_ADMIN_PASSWORD — встроенный админ при
//!     пустой БД (по умолчанию admin/admin; пароль сменить после входа)

mod auth;
mod autotag;
mod backup;
mod db;
pub mod logging;
mod mdns;
mod metadata;
mod models;
mod opds;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio::sync::broadcast;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use db::Db;
use models::{
    Assignment, AssignmentForStudent, AssignmentProgressReq, AssignmentReq, AuthResponse, Book,
    BookmarkSyncItem, ClassNote, ClassNoteReq, ClassProgressRow, DeviceProgress,
    HighlightSyncItem, LoginReq, Quiz, QuizAnswersReq, QuizForStudent, QuizQuestionPublic,
    QuizReq, QuizScore, RegisterReq, Role, ServerStatus, User, UserStatus, WordSyncItem,
};

const VERSION: &str = env!("CARGO_PKG_VERSION");

struct AppState {
    db: Db,
    token: Option<String>,
    name: String,
    /// Папка библиотеки (для сохранения загружаемых книг).
    library: PathBuf,
    /// LAN-IP сервера (для /status и подсказок клиенту).
    address: String,
    /// Реально занятый порт.
    port: u16,
    /// Секрет подписи JWT (персистентный, из meta-таблицы).
    jwt_secret: String,
    /// Папка с обновлениями приложения (manifest.json + APK/инсталляторы).
    updates: PathBuf,
    /// Канал живой рассылки прогресса WS-клиентам (JSON DeviceProgress).
    progress_tx: broadcast::Sender<ProgressMsg>,
    /// Путь файла БД (для автобэкапа/восстановления).
    db_path: PathBuf,
    /// Сигнал фоновой задаче автобэкапа: «настройки изменились, перечитай».
    backup_notify: tokio::sync::Notify,
    /// Троттлинг входа: login → счётчик неудач/время блокировки (анти-брутфорс).
    login_attempts: std::sync::Mutex<HashMap<String, LoginThrottle>>,
}

/// Состояние анти-брутфорса для одного логина.
#[derive(Default, Clone, Copy)]
struct LoginThrottle {
    /// Неудачных попыток подряд (сбрасывается успехом или блокировкой).
    fails: u32,
    /// До какого момента (unix мс) вход заблокирован.
    blocked_until: i64,
}

/// Порог неудач до временной блокировки входа.
const LOGIN_MAX_FAILS: u32 = 5;
/// Длительность блокировки входа после серии неудач, мс.
const LOGIN_BLOCK_MS: i64 = 30_000;

/// Сообщение живой рассылки прогресса: скоуп аккаунта + готовый JSON.
/// scope=None — legacy-клиенты без аккаунта; сокет получает только сообщения
/// своего скоупа (чужой прогресс не утекает другим пользователям).
#[derive(Clone)]
struct ProgressMsg {
    scope: Option<String>,
    json: String,
}

/// Конфигурация запуска сервера. Десктоп задаёт поля напрямую, бинарь —
/// через [`Config::from_env`].
pub struct Config {
    /// Папка с книгами (создаётся при отсутствии).
    pub library: PathBuf,
    /// Файл БД SQLite (каталог, аккаунты, прогресс).
    pub db_path: PathBuf,
    /// Токен пэйринга; если задан — защищённые маршруты требуют Bearer.
    pub token: Option<String>,
    /// Имя сервера (для /status и OPDS).
    pub name: String,
    /// Явный порт; `None` → первый свободный из 9700–9899, иначе эфемерный.
    pub explicit_port: Option<u16>,
    /// Папка веб-сборки (apps/web/dist) для раздачи UI; `None` → только API.
    pub web_dir: Option<PathBuf>,
    /// Папка обновлений приложения: `manifest.json` + файлы (APK, инсталляторы).
    /// Клиенты видят вкладку «Доступно обновление» и скачивают отсюда.
    pub updates: PathBuf,
    /// Логин встроенного администратора (создаётся при пустой БД).
    pub admin_login: String,
    /// Пароль встроенного администратора (по умолчанию — сменить после входа!).
    pub admin_password: String,
}

impl Config {
    /// Собрать конфиг из переменных окружения (для standalone-бинаря).
    pub fn from_env() -> Self {
        Config {
            library: PathBuf::from(env_or("CHITALKA_LIBRARY", "./library")),
            db_path: PathBuf::from(env_or("CHITALKA_DB", "./chitalka.db")),
            token: std::env::var("CHITALKA_TOKEN").ok().filter(|t| !t.is_empty()),
            name: env_or("CHITALKA_NAME", "Школьная библиотека"),
            explicit_port: std::env::var("CHITALKA_PORT")
                .ok()
                .and_then(|s| s.trim().parse::<u16>().ok()),
            // Веб-UI: явный CHITALKA_WEB; иначе папка `web` рядом с exe
            // (standalone-раздача); иначе ../web/dist — запуск из apps/server
            // в монорепо (dev) без env тоже отдаёт читалку, а не 404.
            web_dir: std::env::var("CHITALKA_WEB")
                .ok()
                .map(PathBuf::from)
                .filter(|p| p.is_dir())
                .or_else(|| {
                    std::env::current_exe()
                        .ok()
                        .and_then(|p| p.parent().map(|d| d.join("web")))
                        .filter(|p| p.is_dir())
                })
                .or_else(|| Some(PathBuf::from("../web/dist")).filter(|p| p.is_dir())),
            admin_login: env_or("CHITALKA_ADMIN_LOGIN", "admin"),
            admin_password: env_or("CHITALKA_ADMIN_PASSWORD", "admin"),
            updates: std::env::var("CHITALKA_UPDATES")
                .ok()
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(env_or("CHITALKA_LIBRARY", "./library")).join("_updates")
                }),
        }
    }
}

/// Дескриптор запущенного сервера: реальный адрес/порт и канал остановки.
/// Сервер живёт в фоновой задаче; [`ServerHandle::stop`] корректно его гасит
/// (освобождая порт). Удобно для GUI-управления (десктоп) — старт/стоп.
pub struct ServerHandle {
    /// Реально занятый порт.
    pub port: u16,
    /// LAN-IP сервера (слушает 0.0.0.0).
    pub address: String,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    join: tokio::task::JoinHandle<()>,
    /// Фоновая задача периодического рескана библиотеки.
    rescan: tokio::task::JoinHandle<()>,
    /// Фоновая задача автобэкапа по расписанию.
    autobackup: tokio::task::JoinHandle<()>,
}

impl ServerHandle {
    /// Корректно остановить сервер и дождаться завершения фоновой задачи.
    pub async fn stop(mut self) {
        self.rescan.abort();
        self.autobackup.abort();
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = self.join.await;
    }
}

/// Построить axum-приложение: API-маршруты + (опц.) раздача веб-UI со
/// SPA-fallback на index.html. Вынесено из старого `main`, маршруты не менялись.
fn build_router(state: Arc<AppState>, web_dir: Option<PathBuf>) -> Router {
    // Защищённые маршруты — под проверкой токена (если он задан).
    let protected = Router::new()
        .route("/opds", get(opds_root))
        .route("/opds/all", get(opds_all))
        .route("/opds/mine", get(opds_mine))
        .route("/opds/search", get(opds_search))
        .route("/opds/classes", get(opds_classes))
        .route("/opds/subjects", get(opds_subjects))
        .route("/opds/categories", get(opds_categories))
        .route("/opds/class/{id}", get(opds_by_class))
        .route("/opds/subject/{id}", get(opds_by_subject))
        .route("/opds/category/{id}", get(opds_by_category))
        .route("/books/{id}/file", get(download))
        .route("/api/progress/{book_id}", get(get_progress).put(put_progress))
        .route("/api/words", get(get_words).post(post_words))
        .route_layer(from_fn_with_state(state.clone(), auth));

    let app = Router::new()
        .route("/status", get(status))
        // Аккаунты (ТЗ Часть 6): регистрация/вход открыты, /me — по JWT.
        .route("/api/register", post(register))
        .route("/api/login", post(login))
        .route("/api/me", get(me))
        .route("/api/me/password", post(change_my_password))
        .route("/api/users", get(list_users).post(create_user_admin))
        .route("/api/users/{id}/approve", post(approve_user))
        .route("/api/users/{id}/reject", post(reject_user))
        .route("/api/users/{id}/role", post(set_role))
        .route("/api/users/{id}/password", post(reset_user_password))
        .route("/api/users/{id}", delete(delete_user_admin))
        // Лимит тела поднят до 512 МБ: книги (особенно PDF) крупнее дефолтных
        // 2 МБ axum — иначе аплоад рвётся (на клиенте «NetworkError»).
        .route(
            "/books",
            post(upload_book).layer(DefaultBodyLimit::max(512 * 1024 * 1024)),
        )
        .route("/books/{id}/tags", post(update_book_tags))
        .route("/books/{id}", delete(delete_book))
        .route("/api/assignments", get(list_assignments).post(create_assignment))
        .route("/api/assignments/{id}", delete(delete_assignment))
        .route("/api/assignments/{id}/progress", post(assignment_progress))
        .route("/api/assignments/{id}/report", get(assignment_report))
        // Панель класса: сводный прогресс чтения (учитель своего класса).
        .route("/api/class/{id}/progress", get(class_progress_report))
        // Заметки учителя, видимые классу.
        .route("/api/class-notes", get(get_class_notes).post(post_class_note))
        .route("/api/class-notes/{id}", delete(delete_class_note_handler))
        // Квизы от учителя.
        .route("/api/quizzes", get(list_quizzes_handler).post(create_quiz_handler))
        .route("/api/quizzes/{id}", delete(delete_quiz_handler))
        .route("/api/quizzes/{id}/result", post(submit_quiz_result))
        .route("/api/quizzes/{id}/results", get(quiz_results_handler))
        // Офлайн-словарь: пак кладётся админом в library/_dict/<lang>.json[.gz].
        .route("/api/dict/{lang}", get(dict_file))
        .route("/api/audit", get(get_audit))
        .route("/api/backup", get(backup))
        // Резервные копии: настройки автобэкапа, ручной запуск, список копий,
        // полный архив (БД+книги) и восстановление БД из копии (всё — админ).
        .route(
            "/api/backup/settings",
            get(get_backup_settings).put(put_backup_settings),
        )
        .route("/api/backup/run", post(run_backup_now))
        .route("/api/backup/list", get(list_backup_files))
        .route("/api/backup/full", get(backup_full))
        .route(
            "/api/restore",
            post(restore_db).layer(DefaultBodyLimit::max(512 * 1024 * 1024)),
        )
        // Уровень логирования сервера (админ): посмотреть/сменить на лету.
        .route("/api/log-level", get(get_log_level).put(put_log_level))
        .route("/api/bookmarks", get(get_bookmarks).post(post_bookmarks))
        .route("/api/highlights", get(get_highlights).post(post_highlights))
        // Обновления приложения: манифест и файлы публичны (скачивание APK/
        // инсталлятора должно работать из обычного браузера без заголовков).
        .route("/api/update", get(update_manifest))
        .route("/updates/{file}", get(update_file))
        // WebSocket: токен передаётся в query (браузер не шлёт заголовки для WS).
        .route("/ws", get(ws_handler))
        // Обложка: токен в query — чтобы работало в <img src> (без заголовков).
        .route("/books/{id}/cover", get(cover))
        .merge(protected)
        .with_state(state.clone());

    // Раздача веб-читалки (опц.): неизвестные пути отдаём как статику, а если
    // файла нет — index.html (SPA-роутинг клиента). Тогда http://<сервер>/ в
    // браузере открывает приложение/админку, не только API.
    let app = if let Some(dir) = web_dir {
        let index = dir.join("index.html");
        app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)))
    } else {
        app
    };

    app
        // CORS — внешний слой: обрабатывает preflight до авторизации,
        // чтобы веб-клиент (другой origin) мог обращаться к серверу.
        .layer(CorsLayer::permissive())
        // Журнал HTTP: на уровне debug — каждый запрос (метод/путь/статус/
        // латентность), на verbose (trace) — ещё и момент начала обработки.
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(
                    tower_http::trace::DefaultMakeSpan::new().level(tracing::Level::DEBUG),
                )
                .on_request(
                    tower_http::trace::DefaultOnRequest::new().level(tracing::Level::TRACE),
                )
                .on_response(
                    tower_http::trace::DefaultOnResponse::new()
                        .level(tracing::Level::DEBUG)
                        .latency_unit(tower_http::LatencyUnit::Millis),
                ),
        )
}

/// Создать встроенного администратора, если в БД нет ни одного активного админа.
/// Гарантирует «админ всегда есть» (восстановление доступа): на пустой БД и на
/// БД без админов создаст admin; при наличии админа — ничего не делает.
fn seed_admin(db: &Db, login: &str, password: &str) {
    if db.active_admin_count() != 0 {
        return;
    }
    let pw_hash = match auth::hash_password(password) {
        Ok(h) => h,
        Err(_) => {
            tracing::error!("не удалось захешировать пароль встроенного администратора");
            return;
        }
    };
    let admin = User {
        id: uuid::Uuid::new_v4().to_string(),
        role: Role::Admin,
        status: UserStatus::Active,
        full_name: "Администратор".to_string(),
        login: login.to_string(),
        pw_hash,
        subjects: Vec::new(),
        classes: Vec::new(),
        created_at: now_ms(),
        // Пароль по умолчанию общеизвестен — при первом входе клиент обязан
        // потребовать его смену (PublicUser.mustChangePassword).
        must_change_pw: true,
        token_gen: 0,
    };
    match db.create_user(&admin) {
        Ok(()) => {
            db.log_audit("система", "seed_admin", login);
            tracing::warn!(
                "создан встроенный администратор: логин «{login}». Пароль по умолчанию — СМЕНИТЕ его после входа (env CHITALKA_ADMIN_PASSWORD)"
            );
        }
        Err(_) => tracing::error!("не удалось создать встроенного администратора (логин занят?)"),
    }
}

/// Запустить сервер в фоновой задаче. Возвращает [`ServerHandle`] с реальным
/// портом/адресом; остановка — через [`ServerHandle::stop`]. Для бинаря см.
/// `src/main.rs` (старт + ожидание сигналов), для десктопа — команды Tauri.
pub async fn start(cfg: Config) -> std::io::Result<ServerHandle> {
    std::fs::create_dir_all(&cfg.library).ok();
    let db = Db::open(&cfg.db_path)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("БД: {e}")))?;

    // Сохранённый админом уровень логирования (meta.log_level) применяем сразу
    // после открытия БД — чтобы и стартовые записи шли уже с нужным уровнем.
    // RUST_LOG, заданный руками, главнее (отладка разработчиком).
    if !logging::env_override_active() {
        if let Some(level) = db.meta_get("log_level") {
            match logging::apply_level(&level) {
                Ok(()) => tracing::debug!("уровень логирования из настроек: {level}"),
                Err(e) => tracing::warn!("не удалось применить уровень «{level}»: {e}"),
            }
        }
    }

    match db.scan_library(&cfg.library) {
        Ok(n) => tracing::info!("каталог: добавлено {n} книг из {}", cfg.library.display()),
        Err(e) => tracing::warn!("сканирование библиотеки не удалось: {e}"),
    }

    // Встроенный администратор: при пустой БД создаём учётку admin, чтобы было
    // под чем войти сразу после установки (без «первой регистрации»). Креды —
    // из CHITALKA_ADMIN_LOGIN/PASSWORD или admin/admin. Пароль по умолчанию —
    // небезопасен, поэтому громко просим сменить его после первого входа.
    seed_admin(&db, &cfg.admin_login, &cfg.admin_password);

    // Слушатель (с авто-выбором порта) и реальный адрес.
    let listener = bind_listener(cfg.explicit_port).await;
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let address = mdns::local_ipv4().to_string(); // LAN-IP (0.0.0.0 слушает все)

    let (progress_tx, _) = broadcast::channel::<ProgressMsg>(64);
    let jwt_secret = db.jwt_secret();
    let state = Arc::new(AppState {
        db,
        token: cfg.token,
        name: cfg.name,
        library: cfg.library.clone(),
        address: address.clone(),
        port,
        jwt_secret,
        progress_tx,
        updates: cfg.updates.clone(),
        db_path: cfg.db_path.clone(),
        backup_notify: tokio::sync::Notify::new(),
        login_attempts: std::sync::Mutex::new(HashMap::new()),
    });

    match &cfg.web_dir {
        Some(d) => tracing::info!("раздача веб-UI из {}", d.display()),
        None => tracing::info!("веб-UI не раздаётся (web_dir не задан)"),
    }
    let app = build_router(state.clone(), cfg.web_dir.clone());

    // mDNS-анонс для нативных клиентов (демон держим живым внутри задачи).
    let mdns_daemon = match mdns::announce(&state.name, port, VERSION) {
        Ok(d) => {
            tracing::info!("mDNS: анонс _chitalka._tcp.local (порт {port})");
            Some(d)
        }
        Err(e) => {
            tracing::warn!("mDNS недоступен: {e} (используйте ручной ввод адреса)");
            None
        }
    };

    // Периодический рескан папки библиотеки: книги, добавленные в папку уже
    // после старта (без загрузки через приложение), сами попадают в каталог.
    // scan_library идемпотентен (дедуп по пути) — повтор безопасен.
    let rescan_state = state.clone();
    let rescan_lib = cfg.library.clone();
    let rescan = tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(15));
        tick.tick().await; // первый тик — сразу; пропускаем (уже сканировали на старте)
        loop {
            tick.tick().await;
            match rescan_state.db.scan_library(&rescan_lib) {
                Ok(n) if n > 0 => tracing::info!("рескан: добавлено {n} новых книг"),
                Ok(_) => tracing::trace!("рескан: новых книг нет"),
                Err(e) => tracing::warn!("периодический рескан не удался: {e}"),
            }
        }
    });

    // Автобэкап по расписанию: настройки — в meta-таблице БД (правятся через
    // /api/backup/settings на лету, сигнал — backup_notify). Выключен — задача
    // просто ждёт сигнала об изменении настроек.
    let ab_state = state.clone();
    let autobackup = tokio::spawn(async move {
        loop {
            let s = backup::load_settings(&ab_state.db);
            let delay = backup::next_delay(&ab_state.db, &s);
            match &delay {
                Some(d) => tracing::debug!("автобэкап: следующий запуск через {} с", d.as_secs()),
                None => tracing::debug!("автобэкап выключен — жду изменения настроек"),
            }
            tokio::select! {
                // Настройки изменились — пересчитать расписание.
                _ = ab_state.backup_notify.notified() => continue,
                _ = async {
                    match delay {
                        Some(d) => tokio::time::sleep(d).await,
                        None => std::future::pending::<()>().await,
                    }
                } => {}
            }
            // Пока спали, ручная копия могла закрыть текущий интервал — не дублим.
            if !backup::still_due(&ab_state.db, &s) {
                continue;
            }
            let st = ab_state.clone();
            let cfg = s.clone();
            let res = tokio::task::spawn_blocking(move || {
                backup::perform_backup(&st.db, &st.db_path, &st.library, &cfg)
            })
            .await;
            match res {
                Ok(Ok((name, size))) => {
                    tracing::info!("автобэкап: {name} ({size} байт)");
                    ab_state
                        .db
                        .log_audit("система", "backup", &format!("автокопия {name}"));
                }
                Ok(Err(e)) => tracing::warn!("автобэкап не удался: {e}"),
                Err(e) => tracing::warn!("задача автобэкапа упала: {e}"),
            }
        }
    });

    // Фоновая задача держит сервер; останавливается по oneshot-сигналу.
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        let _mdns = mdns_daemon; // живёт до завершения задачи
        let res = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
        if let Err(e) = res {
            tracing::error!("сервер завершился с ошибкой: {e}");
        }
    });

    Ok(ServerHandle {
        port,
        address,
        shutdown: Some(tx),
        join,
        rescan,
        autobackup,
    })
}

/// Ждёт сигнал завершения и возвращается — после чего `axum` штатно гасит
/// сервер, освобождая порт, и процесс выходит. Это убирает «зависшие» дубли
/// (см. bind_listener: занятый порт заставлял следующий запуск брать соседний).
///
/// Реагируем на закрытие консоли любым способом: Ctrl+C, крестик окна,
/// Ctrl+Break, выход из системы, выключение. Сворачивание окна сигналов не
/// шлёт — на него (по требованию) не реагируем. На остальной функционал не
/// влияет: меняется только момент и чистота остановки.
pub async fn shutdown_signal() {
    #[cfg(windows)]
    {
        use tokio::signal::windows;
        let mut ctrl_c = windows::ctrl_c().expect("ctrl_c handler");
        let mut close = windows::ctrl_close().expect("ctrl_close handler");
        let mut brk = windows::ctrl_break().expect("ctrl_break handler");
        let mut logoff = windows::ctrl_logoff().expect("ctrl_logoff handler");
        let mut shutdown = windows::ctrl_shutdown().expect("ctrl_shutdown handler");
        tokio::select! {
            _ = ctrl_c.recv() => {}
            _ = close.recv() => {}
            _ = brk.recv() => {}
            _ = logoff.recv() => {}
            _ = shutdown.recv() => {}
        }
    }
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
        let mut int = signal(SignalKind::interrupt()).expect("SIGINT handler");
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
    tracing::info!("получен сигнал завершения — останавливаю сервер");
}

/// Привязать слушатель: явный порт, иначе первый свободный 9700–9899, иначе эфемерный.
async fn bind_listener(explicit: Option<u16>) -> tokio::net::TcpListener {
    use tokio::net::TcpListener;
    if let Some(p) = explicit {
        return TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], p)))
            .await
            .unwrap_or_else(|e| panic!("не удалось занять порт {p} (CHITALKA_PORT): {e}"));
    }
    for p in 9700u16..=9899 {
        if let Ok(l) = TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], p))).await {
            return l;
        }
    }
    tracing::warn!("порты 9700–9899 заняты — беру эфемерный");
    TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], 0)))
        .await
        .expect("bind ephemeral")
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// Проверка Bearer-токена пэйринга (если CHITALKA_TOKEN задан). Валидный JWT
/// активного пользователя тоже проходит — иначе вошедший клиент (шлёт JWT
/// вместо кода пэйринга) получал бы 401 на каталоге/синке при заданном токене.
async fn auth(
    State(st): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(tok) = &st.token {
        let expected = format!("Bearer {tok}");
        let ok = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .map(|h| h == expected)
            .unwrap_or(false)
            || current_user(&st, req.headers())
                .map(|u| u.status == UserStatus::Active)
                .unwrap_or(false);
        if !ok {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }
    Ok(next.run(req).await)
}

async fn status(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Json<ServerStatus> {
    // Для вошедшего пользователя — число ВИДИМЫХ ему книг (а не всего каталога),
    // чтобы счётчик в клиенте совпадал с тем, что реально доступно. Без JWT
    // (пинг до входа) — общий счёт.
    let user = current_user(&st, &headers);
    let books = if user.is_some() {
        st.db
            .all_books_access()
            .unwrap_or_default()
            .iter()
            .filter(|b| can_see(user.as_ref(), b))
            .count() as i64
    } else {
        st.db.count_books()
    };
    Json(ServerStatus {
        name: st.name.clone(),
        version: VERSION.to_string(),
        books,
        ok: true,
        address: st.address.clone(),
        port: st.port,
    })
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Пользователь по JWT-строке с проверкой поколения токена: если после выпуска
/// токена пароль сменили или пользователя блокировали (token_gen сдвинулся) —
/// токен отозван. Единая точка для заголовка, query (?token=) и WS.
fn user_from_jwt(st: &AppState, token: &str) -> Option<User> {
    let claims = auth::verify_token(&st.jwt_secret, token)?;
    let user = st.db.user_by_id(&claims.sub).ok().flatten()?;
    if claims.gen != user.token_gen {
        tracing::debug!("отозванный токен (gen {} != {}): {}", claims.gen, user.token_gen, user.login);
        return None;
    }
    Some(user)
}

/// Текущий пользователь из заголовка Authorization: Bearer <JWT>.
fn current_user(st: &AppState, headers: &HeaderMap) -> Option<User> {
    let auth_h = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = auth_h.strip_prefix("Bearer ")?;
    user_from_jwt(st, token)
}

/// Регистрация (ТЗ 6.2). Первый пользователь — администратор (бутстрап);
/// остальные — teacher/student со статусом «ожидает». Возвращает JWT + профиль.
async fn register(State(st): State<Arc<AppState>>, Json(req): Json<RegisterReq>) -> Response {
    if req.full_name.trim().is_empty() || req.login.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Укажите имя, логин и пароль").into_response();
    }
    if let Err(msg) = auth::validate_password(&req.password, &req.login) {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }

    // Бутстрап: самый первый аккаунт становится администратором.
    let (role, status) = if st.db.user_count() == 0 {
        (Role::Admin, UserStatus::Active)
    } else {
        // Самому можно зарегистрироваться только учителем или учеником.
        let r = match Role::from_str(&req.role) {
            Some(Role::Teacher) => Role::Teacher,
            _ => Role::Student,
        };
        (r, UserStatus::Pending)
    };

    let pw_hash = match auth::hash_password(&req.password) {
        Ok(h) => h,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let mut classes = req.classes.clone();
    if let Some(c) = &req.class {
        let c = c.trim();
        if !c.is_empty() && !classes.iter().any(|x| x == c) {
            classes.push(c.to_string());
        }
    }
    let subjects = if role == Role::Teacher { req.subjects.clone() } else { Vec::new() };

    let user = User {
        id: uuid::Uuid::new_v4().to_string(),
        role,
        status,
        full_name: req.full_name.trim().to_string(),
        login: req.login.trim().to_string(),
        pw_hash,
        subjects,
        classes,
        created_at: now_ms(),
        must_change_pw: false, // пароль выбран самим пользователем
        token_gen: 0,
    };

    match st.db.create_user(&user) {
        Ok(()) => {
            st.db.log_audit(
                &user.full_name,
                "register",
                &format!("{} ({})", role.as_str(), user.login),
            );
            let token = auth::issue_token(&st.jwt_secret, &user.id, role, 0).unwrap_or_default();
            Json(AuthResponse { token, user: user.public() }).into_response()
        }
        Err(_) => (StatusCode::CONFLICT, "Логин уже занят").into_response(),
    }
}

/// Вход по логину/паролю. Возвращает JWT + профиль (даже если статус «ожидает» —
/// клиент покажет, что ждёт одобрения; права проверяются на защищённых роутах).
async fn login(State(st): State<Arc<AppState>>, Json(req): Json<LoginReq>) -> Response {
    // Анти-брутфорс: после LOGIN_MAX_FAILS неудач подряд логин блокируется на
    // LOGIN_BLOCK_MS (argon2 сам по себе не мешает перебору по сети).
    let key = req.login.trim().to_lowercase();
    {
        let mut map = st.login_attempts.lock().unwrap();
        // Не даём карте расти бесконечно: чистим отработавшие записи.
        if map.len() > 1000 {
            let now = now_ms();
            map.retain(|_, t| t.fails > 0 || t.blocked_until > now);
        }
        let t = map.entry(key.clone()).or_default();
        if now_ms() < t.blocked_until {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                "Слишком много попыток входа. Подождите 30 секунд.",
            )
                .into_response();
        }
    }
    let fail = |st: &AppState, key: &str| {
        let mut map = st.login_attempts.lock().unwrap();
        let t = map.entry(key.to_string()).or_default();
        t.fails += 1;
        if t.fails >= LOGIN_MAX_FAILS {
            t.blocked_until = now_ms() + LOGIN_BLOCK_MS;
            t.fails = 0;
            tracing::warn!("вход временно заблокирован (перебор паролей?): {key}");
        }
    };
    let user = match st.db.user_by_login(req.login.trim()) {
        Ok(Some(u)) => u,
        Ok(None) => {
            fail(&st, &key);
            return (StatusCode::UNAUTHORIZED, "Неверный логин или пароль").into_response();
        }
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if !auth::verify_password(&req.password, &user.pw_hash) {
        tracing::debug!("вход отклонён (неверный пароль): {}", user.login);
        fail(&st, &key);
        return (StatusCode::UNAUTHORIZED, "Неверный логин или пароль").into_response();
    }
    if user.status == UserStatus::Blocked {
        tracing::debug!("вход отклонён (заблокирован): {}", user.login);
        return (StatusCode::FORBIDDEN, "Учётная запись заблокирована").into_response();
    }
    st.login_attempts.lock().unwrap().remove(&key); // успех сбрасывает счётчик
    let token =
        auth::issue_token(&st.jwt_secret, &user.id, user.role, user.token_gen).unwrap_or_default();
    tracing::debug!("вход: {} ({:?})", user.login, user.role);
    Json(AuthResponse { token, user: user.public() }).into_response()
}

/// Профиль текущего пользователя (по JWT).
async fn me(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    match current_user(&st, &headers) {
        Some(u) => Json(u.public()).into_response(),
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

/// Может ли approver одобрять/блокировать target (ТЗ 6.1).
/// Админ/power — учителей и учеников; учитель — учеников своих классов.
fn can_approve(approver: &User, target: &User) -> bool {
    if approver.status != UserStatus::Active {
        return false;
    }
    match approver.role {
        Role::Admin | Role::Power => matches!(target.role, Role::Teacher | Role::Student),
        Role::Teacher => {
            target.role == Role::Student
                && target.classes.iter().any(|c| approver.classes.contains(c))
        }
        Role::Student => false,
    }
}

/// Список пользователей, доступных текущему для управления/одобрения.
/// Админ/power — все; учитель — ученики своих классов; ученик — никого.
async fn list_users(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active || me.role == Role::Student {
        return StatusCode::FORBIDDEN.into_response();
    }
    let all = st.db.list_users().unwrap_or_default();
    let visible: Vec<_> = all
        .into_iter()
        .filter(|u| match me.role {
            Role::Admin | Role::Power => true,
            Role::Teacher => {
                u.role == Role::Student && u.classes.iter().any(|c| me.classes.contains(c))
            }
            Role::Student => false,
        })
        .map(|u| u.public())
        .collect();
    Json(visible).into_response()
}

/// Сменить статус целевого пользователя с проверкой прав.
fn change_status(st: &AppState, headers: &HeaderMap, id: &str, status: UserStatus) -> Response {
    let Some(me) = current_user(st, headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let target = match st.db.user_by_id(id) {
        Ok(Some(u)) => u,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if !can_approve(&me, &target) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.set_user_status(id, status) {
        Ok(true) => {
            let action = if status == UserStatus::Active { "approve" } else { "reject" };
            st.db.log_audit(&me.full_name, action, &target.full_name);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Разбить строку с CSV-значениями в вектор (без пустых).
fn csv_vec(s: &str) -> Vec<String> {
    s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

/// Допустимые расширения для загрузки книг.
const UPLOAD_EXTS: &[&str] = &["epub", "fb2", "pdf", "cbz", "mobi", "azw3"];

/// Загрузка книги (ТЗ 6.5). Multipart: file, title?, classes?, subjects?, categories?.
/// Права: admin/power/teacher (ученик — нет). Учитель привязывает только к своим
/// классам/предметам (остальное отбрасывается). Файл сохраняется в library/uploads.
async fn upload_book(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active || me.role == Role::Student {
        return (StatusCode::FORBIDDEN, "Нет прав на добавление книг").into_response();
    }

    let mut bytes: Vec<u8> = Vec::new();
    let mut filename = String::new();
    let mut title = String::new();
    let mut classes: Vec<String> = Vec::new();
    let mut subjects: Vec<String> = Vec::new();
    let mut categories: Vec<String> = Vec::new();
    // «Доступна всем» — явный флаг (ТЗ 6.5). По умолчанию выкл: книга без
    // класса/предмета и без этого флага видна только загрузившему и админу.
    let mut public = false;

    loop {
        let field = match mp.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(_) => return (StatusCode::BAD_REQUEST, "Некорректная форма").into_response(),
        };
        match field.name().unwrap_or("") {
            "file" => {
                filename = field.file_name().unwrap_or("book").to_string();
                match field.bytes().await {
                    Ok(b) => bytes = b.to_vec(),
                    Err(_) => return (StatusCode::BAD_REQUEST, "Не удалось прочитать файл").into_response(),
                }
            }
            "title" => title = field.text().await.unwrap_or_default(),
            "classes" => classes = csv_vec(&field.text().await.unwrap_or_default()),
            "subjects" => subjects = csv_vec(&field.text().await.unwrap_or_default()),
            "categories" => categories = csv_vec(&field.text().await.unwrap_or_default()),
            "public" => {
                let v = field.text().await.unwrap_or_default();
                public = matches!(v.trim(), "1" | "true" | "on" | "yes");
            }
            _ => {}
        }
    }

    if bytes.is_empty() {
        return (StatusCode::BAD_REQUEST, "Файл не передан").into_response();
    }
    // Расширение из имени файла.
    let ext = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !UPLOAD_EXTS.contains(&ext.as_str()) {
        return (StatusCode::BAD_REQUEST, "Неподдерживаемый формат книги").into_response();
    }

    // Учитель ограничен своими классами/предметами; админ/power — без ограничений.
    if me.role == Role::Teacher {
        classes.retain(|c| me.classes.contains(c));
        subjects.retain(|s| me.subjects.contains(s));
    }

    // Сохранение файла в library/uploads/<uuid>_<имя>.
    let safe_name: String = filename
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let rel = format!("uploads/{}_{}", uuid::Uuid::new_v4(), safe_name);
    let abs = st.library.join(&rel);
    if let Some(parent) = abs.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    if std::fs::write(&abs, &bytes).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    // Метаданные: заголовок/автор из книги, если заголовок не задан.
    let meta = metadata::extract(&abs, &ext);
    let final_title = if !title.trim().is_empty() {
        title.trim().to_string()
    } else {
        meta.title.clone().unwrap_or_else(|| {
            std::path::Path::new(&safe_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Книга")
                .to_string()
        })
    };

    let id = db::id_for_rel(&rel);
    match st.db.add_book(
        &id,
        &final_title,
        meta.author.as_deref(),
        &ext,
        &abs.to_string_lossy(),
        bytes.len() as i64,
        &classes.join(","),
        &subjects.join(","),
        &categories.join(","),
        public,
        Some(&me.id),
    ) {
        Ok(()) => {
            st.db.log_audit(&me.full_name, "upload", &final_title);
            (StatusCode::CREATED, Json(serde_json::json!({ "id": id }))).into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Запрос обновления тегов/доступа книги (публикация локальной книги).
#[derive(Deserialize)]
struct BookTagsReq {
    #[serde(default)]
    classes: Vec<String>,
    #[serde(default)]
    subjects: Vec<String>,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    public: bool,
}

/// Обновить теги/доступ уже загруженной книги (ТЗ 6.5). Права admin/power/
/// teacher; учитель ограничен своими классами/предметами (как при загрузке).
/// Нужно, чтобы «Добавить книгу» на главной публиковала книгу с тегами, а
/// правка тегов локально доезжала до сервера без повторной загрузки файла.
async fn update_book_tags(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<BookTagsReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active || me.role == Role::Student {
        return (StatusCode::FORBIDDEN, "Нет прав на изменение книг").into_response();
    }
    let mut classes = req.classes;
    let mut subjects = req.subjects;
    if me.role == Role::Teacher {
        // Учитель правит только СВОИ загруженные книги — иначе мог бы скрыть/
        // опубликовать/перетегировать чужие (admin/power — любые).
        match st.db.book_owner(&id) {
            Ok(Some(owner)) if owner.as_deref() == Some(me.id.as_str()) => {}
            Ok(Some(_)) => {
                return (StatusCode::FORBIDDEN, "Можно менять только свои книги").into_response()
            }
            Ok(None) => return StatusCode::NOT_FOUND.into_response(),
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
        classes.retain(|c| me.classes.contains(c));
        subjects.retain(|s| me.subjects.contains(s));
    }
    match st.db.update_book_tags(
        &id,
        &classes.join(","),
        &subjects.join(","),
        &req.categories.join(","),
        req.public,
    ) {
        Ok(true) => {
            st.db.log_audit(&me.full_name, "retag", &id);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Снять книгу с публикации (удалить с сервера). Учитель — только свои
/// загруженные; admin/power — любые. Файл удаляется вместе с записью
/// (иначе периодический рескан папки library вернул бы книгу в каталог).
async fn delete_book(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active || me.role == Role::Student {
        return (StatusCode::FORBIDDEN, "Нет прав на удаление книг").into_response();
    }
    let (path, owner) = match st.db.book_path_owner(&id) {
        Ok(Some(v)) => v,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if me.role == Role::Teacher && owner.as_deref() != Some(me.id.as_str()) {
        return (StatusCode::FORBIDDEN, "Можно снимать с публикации только свои книги")
            .into_response();
    }
    match st.db.delete_book(&id) {
        Ok(true) => {
            if let Err(e) = std::fs::remove_file(&path) {
                // Запись уже удалена; файл мог быть удалён вручную — не критично,
                // но если файл остался в library, рескан вернёт книгу в каталог.
                tracing::warn!("не удалось удалить файл книги {path}: {e}");
            }
            st.db.log_audit(&me.full_name, "unpublish", &id);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Одобрить пользователя (статус → active).
async fn approve_user(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    change_status(&st, &headers, &id, UserStatus::Active)
}

/// Отклонить/заблокировать пользователя (статус → blocked).
async fn reject_user(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    change_status(&st, &headers, &id, UserStatus::Blocked)
}

/// Может ли `me` назначать роль `target_role` (создание/смена роли).
/// Админ — любые роли; power — только teacher/student; остальные — нет.
fn can_assign_role(me: &User, target_role: Role) -> bool {
    match me.role {
        Role::Admin => true,
        Role::Power => matches!(target_role, Role::Teacher | Role::Student),
        _ => false,
    }
}

/// Запрос на создание пользователя администратором (без саморегистрации).
#[derive(Deserialize)]
struct CreateUserReq {
    #[serde(rename = "fullName")]
    full_name: String,
    login: String,
    password: String,
    role: String,
    #[serde(default)]
    classes: Vec<String>,
    #[serde(default)]
    subjects: Vec<String>,
}

/// Создать пользователя (админ/power). Сразу активен — без одобрения.
/// Админ может создать любую роль; power — только teacher/student.
async fn create_user_admin(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<CreateUserReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(role) = Role::from_str(&req.role) else {
        return (StatusCode::BAD_REQUEST, "Неизвестная роль").into_response();
    };
    if !can_assign_role(&me, role) {
        return (StatusCode::FORBIDDEN, "Недостаточно прав для этой роли").into_response();
    }
    if req.full_name.trim().is_empty() || req.login.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "Укажите имя, логин и пароль").into_response();
    }
    if let Err(msg) = auth::validate_password(&req.password, &req.login) {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let pw_hash = match auth::hash_password(&req.password) {
        Ok(h) => h,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let subjects = if role == Role::Teacher { req.subjects.clone() } else { Vec::new() };
    let user = User {
        id: uuid::Uuid::new_v4().to_string(),
        role,
        status: UserStatus::Active, // создан админом — одобрение не нужно
        full_name: req.full_name.trim().to_string(),
        login: req.login.trim().to_string(),
        pw_hash,
        subjects,
        classes: req.classes.clone(),
        created_at: now_ms(),
        // Пароль назначен админом → пользователь сменит его при первом входе.
        must_change_pw: true,
        token_gen: 0,
    };
    match st.db.create_user(&user) {
        Ok(()) => {
            st.db.log_audit(
                &me.full_name,
                "create_user",
                &format!("{} ({})", role.as_str(), user.login),
            );
            Json(user.public()).into_response()
        }
        Err(_) => (StatusCode::CONFLICT, "Логин уже занят").into_response(),
    }
}

/// Запрос смены роли.
#[derive(Deserialize)]
struct SetRoleReq {
    role: String,
}

/// Сменить роль пользователя (админ/power). Нельзя менять свою роль (защита от
/// самоблокировки) и нельзя выдавать роль выше своих прав (power → только
/// teacher/student, и только им же).
async fn set_role(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<SetRoleReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    if me.id == id {
        return (StatusCode::BAD_REQUEST, "Нельзя менять свою роль").into_response();
    }
    let Some(new_role) = Role::from_str(&req.role) else {
        return (StatusCode::BAD_REQUEST, "Неизвестная роль").into_response();
    };
    let target = match st.db.user_by_id(&id) {
        Ok(Some(u)) => u,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // Нужны права и на текущую роль цели, и на назначаемую роль.
    if !can_assign_role(&me, target.role) || !can_assign_role(&me, new_role) {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    match st.db.set_user_role(&id, new_role) {
        Ok(true) => {
            st.db.log_audit(
                &me.full_name,
                "set_role",
                &format!("{} → {}", target.login, new_role.as_str()),
            );
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Удалить пользователя (админ/power по правам на роль цели). Нельзя удалить себя.
async fn delete_user_admin(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    if me.id == id {
        return (StatusCode::BAD_REQUEST, "Нельзя удалить себя").into_response();
    }
    let target = match st.db.user_by_id(&id) {
        Ok(Some(u)) => u,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if !can_assign_role(&me, target.role) {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    match st.db.delete_user(&id) {
        Ok(true) => {
            st.db.log_audit(&me.full_name, "delete_user", &target.login);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Смена собственного пароля.
#[derive(Deserialize)]
struct ChangePwReq {
    #[serde(rename = "oldPassword")]
    old_password: String,
    #[serde(rename = "newPassword")]
    new_password: String,
}

/// Сменить свой пароль (нужен текущий). Доступно любому вошедшему.
async fn change_my_password(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ChangePwReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !auth::verify_password(&req.old_password, &me.pw_hash) {
        return (StatusCode::FORBIDDEN, "Неверный текущий пароль").into_response();
    }
    if let Err(msg) = auth::validate_password(&req.new_password, &me.login) {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    let pw_hash = match auth::hash_password(&req.new_password) {
        Ok(h) => h,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // Смена пароля отзывает ВСЕ старые токены (token_gen+1) — в т.ч. текущий.
    // Возвращаем свежий JWT нового поколения, чтобы клиент не разлогинился.
    match st.db.set_user_password(&me.id, &pw_hash, false) {
        Ok(true) => {
            st.db.log_audit(&me.full_name, "change_password", &me.login);
            let gen = st.db.token_gen(&me.id).unwrap_or(me.token_gen + 1);
            let token =
                auth::issue_token(&st.jwt_secret, &me.id, me.role, gen).unwrap_or_default();
            Json(serde_json::json!({ "token": token })).into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Сброс пароля пользователя администратором.
#[derive(Deserialize)]
struct ResetPwReq {
    #[serde(rename = "newPassword")]
    new_password: String,
}

/// Сбросить пароль другого пользователя (админ/power по правам на роль цели).
/// Текущий пароль не требуется. Свой пароль — через /api/me/password.
async fn reset_user_password(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<ResetPwReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    let target = match st.db.user_by_id(&id) {
        Ok(Some(u)) => u,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if let Err(msg) = auth::validate_password(&req.new_password, &target.login) {
        return (StatusCode::BAD_REQUEST, msg).into_response();
    }
    // Свой пароль меняем только через /api/me/password (с текущим паролем).
    if me.id == target.id {
        return (StatusCode::BAD_REQUEST, "Свой пароль меняйте через смену пароля").into_response();
    }
    if !can_assign_role(&me, target.role) {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    let pw_hash = match auth::hash_password(&req.new_password) {
        Ok(h) => h,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // Сброшенный пароль временный: цель обязана сменить его при первом входе;
    // старые токены цели отзываются (token_gen+1).
    match st.db.set_user_password(&id, &pw_hash, true) {
        Ok(true) => {
            st.db.log_audit(&me.full_name, "reset_password", &target.login);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// --- Синхронизация закладок/выделений (per-user, ТЗ Часть 6, п.6.3) ---

async fn get_bookmarks(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<SinceQuery>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.bookmarks_since(&me.id, q.since) {
        Ok(v) => Json(v).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn post_bookmarks(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(items): Json<Vec<BookmarkSyncItem>>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.upsert_bookmarks(&me.id, &items) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn get_highlights(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<SinceQuery>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.highlights_since(&me.id, q.since) {
        Ok(v) => Json(v).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn post_highlights(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(items): Json<Vec<HighlightSyncItem>>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.upsert_highlights(&me.id, &items) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// --- Аудит и бэкап (ТЗ Часть 6, E8+E9) ---

/// Журнал действий (только админ/power).
async fn get_audit(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active || !matches!(me.role, Role::Admin | Role::Power) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.recent_audit(300) {
        Ok(rows) => Json(rows).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Проверка «активный админ» для операций с резервными копиями.
/// Err — готовый HTTP-ответ (401/403).
fn require_admin(st: &AppState, headers: &HeaderMap) -> Result<User, Response> {
    let Some(me) = current_user(st, headers) else {
        return Err(StatusCode::UNAUTHORIZED.into_response());
    };
    if me.status != UserStatus::Active || me.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(me)
}

/// Удалить временные файлы бэкапа старше часа (temp-файлы стриминга нельзя
/// удалять, пока они отдаются клиенту — чистим отложенно при следующем вызове).
fn cleanup_stale_backup_tmp() {
    let dir = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let hour_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with("chitalka_backup_") && !name.starts_with("chitalka_full_") {
            continue;
        }
        if let Ok(meta) = e.metadata() {
            if meta.modified().map(|t| t < hour_ago).unwrap_or(false) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// Отдать файл потоком с заголовком attachment (без чтения в память).
async fn stream_attachment(path: &std::path::Path, download_name: &str) -> Response {
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let len = file.metadata().await.map(|m| m.len()).ok();
    let stream = tokio_util::io::ReaderStream::new(file);
    let mut resp = (
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{download_name}\""),
            ),
        ],
        Body::from_stream(stream),
    )
        .into_response();
    if let Some(len) = len {
        if let Ok(v) = len.to_string().parse() {
            resp.headers_mut().insert(header::CONTENT_LENGTH, v);
        }
    }
    resp
}

/// Скачать резервную копию БД (только админ). VACUUM INTO → поток файла
/// (без чтения целиком в память — БД может быть большой).
async fn backup(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let me = match require_admin(&st, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    cleanup_stale_backup_tmp();
    let tmp = std::env::temp_dir().join(format!("chitalka_backup_{}.db", now_ms()));
    let db_st = st.clone();
    let tmp2 = tmp.clone();
    let ok = tokio::task::spawn_blocking(move || db_st.db.backup_to(&tmp2).is_ok())
        .await
        .unwrap_or(false);
    if !ok {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    st.db.log_audit(&me.full_name, "backup", "скачана резервная копия");
    stream_attachment(&tmp, "chitalka-backup.db").await
}

/// Скачать ПОЛНУЮ резервную копию (только админ): zip с БД и папкой книг.
async fn backup_full(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let me = match require_admin(&st, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    cleanup_stale_backup_tmp();
    let tmp = std::env::temp_dir().join(format!("chitalka_full_{}.zip", now_ms()));
    let db_st = st.clone();
    let tmp2 = tmp.clone();
    let res = tokio::task::spawn_blocking(move || {
        backup::write_full_zip(&db_st.db, &db_st.library, &tmp2)
    })
    .await;
    if !matches!(res, Ok(Ok(()))) {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    st.db
        .log_audit(&me.full_name, "backup", "скачан полный архив (БД + книги)");
    stream_attachment(&tmp, "chitalka-full-backup.zip").await
}

/// Текущие настройки автобэкапа + фактическая папка и время последней копии.
async fn get_backup_settings(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = require_admin(&st, &headers) {
        return r;
    }
    let s = backup::load_settings(&st.db);
    let dir = backup::resolve_dir(&s, &st.db_path);
    let last: Option<i64> = st.db.meta_get("backup_last_ms").and_then(|v| v.parse().ok());
    Json(serde_json::json!({
        "settings": s,
        "resolvedDir": dir.to_string_lossy(),
        "lastBackupMs": last,
    }))
    .into_response()
}

/// Сохранить настройки автобэкапа (валидация + сигнал фоновой задаче).
async fn put_backup_settings(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(s): Json<backup::BackupSettings>,
) -> Response {
    let me = match require_admin(&st, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    if let Err(e) = backup::save_settings(&st.db, &s) {
        return (StatusCode::BAD_REQUEST, e).into_response();
    }
    st.backup_notify.notify_one(); // задача перечитает расписание
    st.db.log_audit(
        &me.full_name,
        "backup_settings",
        &format!(
            "автобэкап: {}, {}, хранить {}",
            if s.enabled { "вкл" } else { "выкл" },
            if s.mode == "daily" {
                format!("ежедневно в {}", s.daily_at)
            } else {
                format!("каждые {} ч", s.every_hours)
            },
            s.keep
        ),
    );
    StatusCode::NO_CONTENT.into_response()
}

/// Сделать резервную копию прямо сейчас (в папку из настроек, с ротацией).
async fn run_backup_now(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let me = match require_admin(&st, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let s = backup::load_settings(&st.db);
    let db_st = st.clone();
    let s2 = s.clone();
    let res = tokio::task::spawn_blocking(move || {
        backup::perform_backup(&db_st.db, &db_st.db_path, &db_st.library, &s2)
    })
    .await;
    match res {
        Ok(Ok((name, size))) => {
            st.db
                .log_audit(&me.full_name, "backup", &format!("ручная копия {name}"));
            Json(serde_json::json!({ "file": name, "size": size })).into_response()
        }
        _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Список копий в папке бэкапов (свежие сверху).
async fn list_backup_files(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = require_admin(&st, &headers) {
        return r;
    }
    let s = backup::load_settings(&st.db);
    let dir = backup::resolve_dir(&s, &st.db_path);
    Json(backup::list_backups(&dir)).into_response()
}

/// Восстановить БД из загруженной копии (.db, multipart-поле file).
/// Перед восстановлением автоматически сохраняется страховочная копия
/// текущей БД (pre-restore) в папку бэкапов. После — рекомендуем перезапуск.
async fn restore_db(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Response {
    let me = match require_admin(&st, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    // Достаём файл из multipart.
    let mut bytes: Option<Vec<u8>> = None;
    while let Ok(Some(field)) = mp.next_field().await {
        if field.name() == Some("file") {
            match field.bytes().await {
                Ok(b) => bytes = Some(b.to_vec()),
                Err(_) => return (StatusCode::BAD_REQUEST, "файл не дочитан").into_response(),
            }
        }
    }
    let Some(bytes) = bytes else {
        return (StatusCode::BAD_REQUEST, "нет поля file").into_response();
    };
    // Быстрая проверка формата до каких-либо действий с живой БД.
    if !bytes.starts_with(b"SQLite format 3\0") {
        return (StatusCode::BAD_REQUEST, "это не файл базы SQLite").into_response();
    }
    let tmp = std::env::temp_dir().join(format!("chitalka_restore_{}.db", now_ms()));
    if std::fs::write(&tmp, &bytes).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    // Страховочная копия текущей БД — рядом с обычными бэкапами.
    let s = backup::load_settings(&st.db);
    let dir = backup::resolve_dir(&s, &st.db_path);
    let _ = std::fs::create_dir_all(&dir);
    let safety = dir.join(format!("pre-restore-{}.db", now_ms()));
    let db_st = st.clone();
    let tmp2 = tmp.clone();
    let res = tokio::task::spawn_blocking(move || {
        db_st
            .db
            .backup_to(&safety)
            .map_err(|e| format!("страховочная копия: {e}"))?;
        db_st
            .db
            .restore_from(&tmp2)
            .map_err(|e| format!("восстановление: {e}"))
    })
    .await;
    let _ = std::fs::remove_file(&tmp);
    match res {
        Ok(Ok(())) => {
            st.db
                .log_audit(&me.full_name, "restore", "БД восстановлена из копии");
            Json(serde_json::json!({
                "ok": true,
                "message": "База восстановлена. Перезапустите сервер, чтобы применились миграции и все клиенты переподключились."
            }))
            .into_response()
        }
        Ok(Err(e)) => (StatusCode::BAD_REQUEST, e).into_response(),
        _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// --- Уровень логирования (админ) ---

/// Текущий уровень логирования и список допустимых.
async fn get_log_level(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Err(r) = require_admin(&st, &headers) {
        return r;
    }
    let level = st.db.meta_get("log_level").unwrap_or_else(|| "info".to_string());
    Json(serde_json::json!({
        "level": level,
        "levels": logging::LEVELS,
        // RUST_LOG задан руками — сохранённый уровень при старте игнорируется.
        "envOverride": logging::env_override_active(),
    }))
    .into_response()
}

#[derive(Deserialize)]
struct LogLevelReq {
    level: String,
}

/// Сменить уровень логирования: применяется сразу и сохраняется в БД
/// (переживает перезапуск). По умолчанию — info.
async fn put_log_level(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<LogLevelReq>,
) -> Response {
    let me = match require_admin(&st, &headers) {
        Ok(u) => u,
        Err(r) => return r,
    };
    let level = req.level.trim().to_lowercase();
    if logging::filter_for(&level).is_none() {
        return (
            StatusCode::BAD_REQUEST,
            format!("уровень должен быть одним из: {}", logging::LEVELS.join(", ")),
        )
            .into_response();
    }
    if st.db.meta_set("log_level", &level).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    // Смена на лету. Не фатально, если подписчик не наш (встраивание в десктоп)
    // — уровень сохранён и применится там, где логированием владеет сервер.
    if let Err(e) = logging::apply_level(&level) {
        tracing::warn!("уровень «{level}» сохранён, но не применён: {e}");
    } else {
        tracing::info!("уровень логирования: {level}");
    }
    st.db
        .log_audit(&me.full_name, "log_level", &format!("уровень логирования: {level}"));
    StatusCode::NO_CONTENT.into_response()
}

// --- Задания (ТЗ Часть 6, п.6.5) ---

/// Может ли пользователь распоряжаться заданиями данного класса.
fn can_manage_class(u: &User, class_id: &str) -> bool {
    u.status == UserStatus::Active
        && match u.role {
            Role::Admin | Role::Power => true,
            Role::Teacher => u.classes.iter().any(|c| c == class_id),
            Role::Student => false,
        }
}

/// Создать задание (учитель — для своих классов; админ/power — любых).
async fn create_assignment(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<AssignmentReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !can_manage_class(&me, &req.class_id) {
        return (StatusCode::FORBIDDEN, "Нет прав на этот класс").into_response();
    }
    let Some(book_title) = st.db.book_title(&req.book_id) else {
        return (StatusCode::NOT_FOUND, "Книга не найдена").into_response();
    };
    let a = Assignment {
        id: uuid::Uuid::new_v4().to_string(),
        book_id: req.book_id,
        book_title: book_title.clone(),
        class_id: req.class_id,
        title: req.title.filter(|t| !t.trim().is_empty()).unwrap_or(book_title),
        note: req.note.filter(|n| !n.trim().is_empty()),
        due_at: req.due_at,
        created_by: me.id.clone(),
        created_at: now_ms(),
    };
    match st.db.create_assignment(&a) {
        Ok(()) => {
            st.db.log_audit(&me.full_name, "assign", &format!("{} → класс {}", a.title, a.class_id));
            (StatusCode::CREATED, Json(a)).into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Список заданий: ученику — по его классам с личным статусом; учителю — по его
/// классам; админ/power — все.
async fn list_assignments(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    let all = st.db.list_assignments().unwrap_or_default();
    match me.role {
        Role::Student => {
            let mine: Vec<AssignmentForStudent> = all
                .into_iter()
                .filter(|a| me.classes.iter().any(|c| c == &a.class_id))
                .map(|a| {
                    let s = st.db.assignment_status_for(&a.id, &me.id);
                    AssignmentForStudent {
                        status: s.as_ref().map(|x| x.0.clone()).unwrap_or_else(|| "not_started".into()),
                        fraction: s.as_ref().map(|x| x.1).unwrap_or(0.0),
                        assignment: a,
                    }
                })
                .collect();
            Json(mine).into_response()
        }
        Role::Teacher => {
            let mine: Vec<Assignment> = all
                .into_iter()
                .filter(|a| me.classes.iter().any(|c| c == &a.class_id))
                .collect();
            Json(mine).into_response()
        }
        Role::Admin | Role::Power => Json(all).into_response(),
    }
}

/// Удалить задание (создатель или админ/power).
async fn delete_assignment(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(a)) = st.db.assignment_by_id(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let allowed = matches!(me.role, Role::Admin | Role::Power) || a.created_by == me.id;
    if me.status != UserStatus::Active || !allowed {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.delete_assignment(&id) {
        Ok(()) => {
            st.db.log_audit(&me.full_name, "unassign", &a.title);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Отметка ученика о выполнении задания (status: reading|done).
async fn assignment_progress(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<AssignmentProgressReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(a)) = st.db.assignment_by_id(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // Отмечать может только ученик класса задания.
    if me.status != UserStatus::Active
        || me.role != Role::Student
        || !me.classes.iter().any(|c| c == &a.class_id)
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let status = if req.status == "done" { "done" } else { "reading" };
    let frac = if status == "done" { 1.0 } else { req.fraction.clamp(0.0, 1.0) };
    match st.db.set_assignment_progress(&id, &me.id, status, frac) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Отчёт по заданию (учитель своего класса / админ / power): ученики + статусы.
async fn assignment_report(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(a)) = st.db.assignment_by_id(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !can_manage_class(&me, &a.class_id) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match st.db.assignment_report(&a) {
        Ok(rows) => Json(rows).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Ответ OPDS-фидом с корректным content-type.
fn opds_response(xml: String) -> Response {
    (
        [(
            header::CONTENT_TYPE,
            "application/atom+xml;profile=opds-catalog",
        )],
        xml,
    )
        .into_response()
}

/// Видна ли книга пользователю (ТЗ 6.5). Без JWT/неактивный — только «доступна
/// всем». Админ/power — всё. Учитель — public, свои загрузки, пересечение по
/// классам ИЛИ предметам. Ученик — public или пересечение по классам.
fn can_see(user: Option<&User>, b: &db::BookAccess) -> bool {
    let Some(u) = user else {
        return b.public;
    };
    if u.status != UserStatus::Active {
        return b.public;
    }
    match u.role {
        Role::Admin | Role::Power => true,
        Role::Teacher => {
            b.public
                || b.owner_id.as_deref() == Some(u.id.as_str())
                || b.classes.iter().any(|c| u.classes.contains(c))
                || b.subjects.iter().any(|s| u.subjects.contains(s))
        }
        Role::Student => b.public || b.classes.iter().any(|c| u.classes.contains(c)),
    }
}

/// Книги, видимые пользователю из запроса (фильтр по JWT-правам).
fn visible_books(st: &AppState, headers: &HeaderMap) -> Vec<db::BookAccess> {
    let user = current_user(st, headers);
    st.db
        .all_books_access()
        .unwrap_or_default()
        .into_iter()
        .filter(|b| can_see(user.as_ref(), b))
        .collect()
}

/// Извлечь сами книги (Book) из набора доступа — для acquisition-фида.
fn books_of(access: &[db::BookAccess]) -> Vec<Book> {
    access.iter().map(|a| a.book.clone()).collect()
}

/// Корневой навигационный фид (по измерениям + все книги). Пункт «Мои книги»
/// показываем тем, кто загружает (учитель/power/admin).
async fn opds_root(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let show_mine = current_user(&st, &headers)
        .map(|u| matches!(u.role, Role::Admin | Role::Power | Role::Teacher))
        .unwrap_or(false);
    opds_response(opds::navigation_root(&st.name, show_mine))
}

/// Acquisition-фид всех видимых пользователю книг.
async fn opds_all(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let books = books_of(&visible_books(&st, &headers));
    opds_response(opds::acquisition_feed(&st.name, &books))
}

/// Acquisition-фид «Мои книги» — то, что текущий пользователь загрузил сам.
async fn opds_mine(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let books: Vec<Book> = st
        .db
        .all_books_access()
        .unwrap_or_default()
        .into_iter()
        .filter(|b| b.owner_id.as_deref() == Some(me.id.as_str()))
        .map(|a| a.book)
        .collect();
    opds_response(opds::acquisition_feed(&format!("{} — Мои книги", st.name), &books))
}

/// Параметры поиска книг.
#[derive(Deserialize)]
struct SearchQuery {
    #[serde(default)]
    q: String,
}

/// Поиск по названию/автору среди видимых книг. Пустой запрос → пустая выдача.
async fn opds_search(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(p): Query<SearchQuery>,
) -> Response {
    let needle = p.q.trim().to_lowercase();
    if needle.is_empty() {
        return opds_response(opds::acquisition_feed(&st.name, &[]));
    }
    let books: Vec<Book> = visible_books(&st, &headers)
        .into_iter()
        .map(|a| a.book)
        .filter(|b| {
            b.title.to_lowercase().contains(&needle)
                || b.author.as_deref().map(|a| a.to_lowercase().contains(&needle)).unwrap_or(false)
        })
        .collect();
    opds_response(opds::acquisition_feed(&st.name, &books))
}

/// Имя колонки тегов BookAccess по имени измерения OPDS.
fn dim_tags<'a>(b: &'a db::BookAccess, dim: &str) -> &'a [String] {
    match dim {
        "class" => &b.classes,
        "subject" => &b.subjects,
        "category" => &b.categories,
        _ => &[],
    }
}

/// Навигационный фид со списком значений измерения (по видимым книгам).
fn dimension_feed(st: &AppState, headers: &HeaderMap, dim: &str, title: &str) -> Response {
    let visible = visible_books(st, headers);
    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for b in &visible {
        for v in dim_tags(b, dim) {
            *counts.entry(v.clone()).or_insert(0) += 1;
        }
    }
    let mut values: Vec<(String, i64)> = counts.into_iter().collect();
    if dim == "class" {
        values.sort_by_key(|(v, _)| v.parse::<i64>().unwrap_or(i64::MAX));
    } else {
        values.sort_by(|a, b| a.0.cmp(&b.0));
    }
    opds_response(opds::dimension_list(title, dim, &values))
}

async fn opds_classes(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    dimension_feed(&st, &headers, "class", "По классам")
}
async fn opds_subjects(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    dimension_feed(&st, &headers, "subject", "По предметам")
}
async fn opds_categories(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    dimension_feed(&st, &headers, "category", "По категориям")
}

/// Acquisition-фид видимых книг с данным значением измерения.
fn tag_feed(st: &AppState, headers: &HeaderMap, dim: &str, id: &str) -> Response {
    let books: Vec<Book> = visible_books(st, headers)
        .into_iter()
        .filter(|b| dim_tags(b, dim).iter().any(|v| v == id))
        .map(|a| a.book)
        .collect();
    let title = format!("{} — {}", st.name, autotag::label(dim, id));
    opds_response(opds::acquisition_feed(&title, &books))
}

async fn opds_by_class(State(st): State<Arc<AppState>>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    tag_feed(&st, &headers, "class", &id)
}
async fn opds_by_subject(State(st): State<Arc<AppState>>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    tag_feed(&st, &headers, "subject", &id)
}
async fn opds_by_category(State(st): State<Arc<AppState>>, headers: HeaderMap, Path(id): Path<String>) -> Response {
    tag_feed(&st, &headers, "category", &id)
}

/// Раздача файла книги с поддержкой Range (докачка/перемотка — ТЗ 4.7).
/// Доступ проверяется по правам пользователя (ТЗ 6.5): нельзя скачать по id
/// книгу, которая пользователю не видна (иначе фильтр каталога обходится).
async fn download(State(st): State<Arc<AppState>>, Path(id): Path<String>, req: Request) -> Response {
    let user = current_user(&st, req.headers());
    // Точечный запрос: не читаем весь каталог на каждое скачивание.
    let allowed = st
        .db
        .book_access_by_id(&id)
        .ok()
        .flatten()
        .map(|b| can_see(user.as_ref(), &b))
        .unwrap_or(false);
    if !allowed {
        // 404 (не 403), чтобы не раскрывать существование скрытой книги.
        tracing::debug!("скачивание отклонено (нет доступа/книги): {id}");
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(path)) = st.db.book_path(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    tracing::debug!("скачивание книги {id}");
    // ServeFile сам обрабатывает Range и заголовки кэширования.
    match ServeFile::new(path).oneshot(req).await {
        Ok(res) => res.map(Body::new),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Обложка книги (EPUB). Токен — в query (для <img> заголовки не шлются):
/// либо код пэйринга, либо JWT. Видимость книги проверяется как у download —
/// иначе по id утекали бы обложки скрытых от пользователя книг.
async fn cover(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<WsQuery>,
) -> Response {
    // JWT из query → пользователь (для can_see). Не JWT — проверяем пэйринг.
    let user = q.token.as_deref().and_then(|t| user_from_jwt(&st, t));
    if user.is_none() {
        if let Some(tok) = &st.token {
            if q.token.as_deref() != Some(tok.as_str()) {
                return StatusCode::UNAUTHORIZED.into_response();
            }
        }
    }
    // Точечный запрос: не читаем весь каталог на каждую обложку.
    let allowed = st
        .db
        .book_access_by_id(&id)
        .ok()
        .flatten()
        .map(|b| can_see(user.as_ref(), &b))
        .unwrap_or(false);
    if !allowed {
        // 404 (не 403), чтобы не раскрывать существование скрытой книги.
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(Some(path)) = st.db.book_path(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    match metadata::extract_cover(&path, &ext) {
        Some((bytes, mime)) => (
            [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
            ],
            bytes,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Скоуп синка прогресса/слов (Часть 6): id вошедшего активного пользователя,
/// иначе '' — legacy-скоуп клиентов без аккаунта (старое поведение per-device).
fn sync_scope(st: &AppState, headers: &HeaderMap) -> String {
    current_user(st, headers)
        .filter(|u| u.status == UserStatus::Active)
        .map(|u| u.id)
        .unwrap_or_default()
}

async fn get_progress(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(book_id): Path<String>,
) -> Response {
    match st.db.latest_progress(&sync_scope(&st, &headers), &book_id) {
        Ok(Some(p)) => Json(p).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn put_progress(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(_book_id): Path<String>,
    Json(mut p): Json<DeviceProgress>,
) -> StatusCode {
    // Владельца определяет сервер по JWT — значение из тела игнорируем
    // (клиент не может писать прогресс в чужой аккаунт).
    let scope = sync_scope(&st, &headers);
    p.user_id = if scope.is_empty() { None } else { Some(scope.clone()) };
    match st.db.upsert_progress(&scope, &p) {
        Ok(()) => {
            tracing::trace!(
                "прогресс: книга {} устройство {} {:.1}%",
                p.book_id,
                p.device_id,
                p.progress * 100.0
            );
            // Живая рассылка другим устройствам («продолжить везде», ТЗ 4.9.4) —
            // только сокетам того же аккаунта (или legacy-сокетам для scope='').
            if let Ok(json) = serde_json::to_string(&p) {
                let _ = st.progress_tx.send(ProgressMsg { scope: p.user_id.clone(), json });
            }
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

// --- Обновления приложения (вкладка «Доступно обновление») ---

/// Манифест обновлений: содержимое `<updates>/manifest.json` как есть.
/// Формат: {"version":"0.2.0","notes":"…","files":{"android":"app.apk",
/// "windows":"setup.exe","linux":"app.AppImage"}}. 404 — обновлений нет.
async fn update_manifest(State(st): State<Arc<AppState>>) -> Response {
    match std::fs::read(st.updates.join("manifest.json")) {
        Ok(bytes) => (
            [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Отдать файл обновления из папки updates (плоский список, без подпапок).
async fn update_file(State(st): State<Arc<AppState>>, Path(file): Path<String>) -> Response {
    // Только имя файла: защита от выхода из папки (../, вложенные пути).
    if file.contains("..") || file.contains('/') || file.contains('\\') || file.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let path = st.updates.join(&file);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    // APK — правильный тип, чтобы Android-браузер предложил установку.
    let ctype = if file.to_lowercase().ends_with(".apk") {
        "application/vnd.android.package-archive"
    } else {
        "application/octet-stream"
    };
    (
        [
            (header::CONTENT_TYPE, ctype.to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{file}\""),
            ),
        ],
        bytes,
    )
        .into_response()
}

/// WebSocket живой синхронизации прогресса. Токен — в query (?token=…):
/// код пэйринга (legacy-скоуп) или JWT (скоуп аккаунта — сокет получает
/// только прогресс своего пользователя).
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(st): State<Arc<AppState>>,
    Query(q): Query<WsQuery>,
) -> Response {
    // JWT → скоуп аккаунта.
    let jwt_user = q
        .token
        .as_deref()
        .and_then(|t| user_from_jwt(&st, t))
        .filter(|u| u.status == UserStatus::Active);
    let scope: Option<String> = match jwt_user {
        Some(u) => Some(u.id),
        None => {
            // Не JWT: если задан код пэйринга — он обязан совпасть.
            if let Some(tok) = &st.token {
                if q.token.as_deref() != Some(tok.as_str()) {
                    return StatusCode::UNAUTHORIZED.into_response();
                }
            }
            None // legacy-скоуп (клиенты без аккаунта)
        }
    };
    let rx = st.progress_tx.subscribe();
    tracing::debug!(
        "WS-подключение (скоуп: {})",
        scope.as_deref().unwrap_or("legacy")
    );
    ws.on_upgrade(move |socket| ws_loop(socket, rx, scope))
}

/// Пересылаем рассылку прогресса в сокет (только сообщения своего скоупа),
/// читаем входящие до закрытия.
async fn ws_loop(
    mut socket: WebSocket,
    mut rx: broadcast::Receiver<ProgressMsg>,
    scope: Option<String>,
) {
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(m) => {
                    if m.scope != scope {
                        continue; // чужой аккаунт — не пересылаем
                    }
                    if socket.send(Message::Text(m.json.into())).await.is_err() {
                        break;
                    }
                }
                // Отстали от рассылки — продолжаем со свежих сообщений.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
        }
    }
}

#[derive(Deserialize)]
struct SinceQuery {
    #[serde(default)]
    since: i64,
}

#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

// --- Панель класса: сводный прогресс чтения (E2) ---

/// Сводный прогресс класса: каждая строка — ученик × книга (последняя позиция
/// среди его устройств). Права: учитель своего класса, admin/power — любые.
async fn class_progress_report(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(class_id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !can_manage_class(&me, &class_id) {
        return (StatusCode::FORBIDDEN, "Нет прав на этот класс").into_response();
    }
    let students = match st.db.students_in_class(&class_id) {
        Ok(v) => v,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    // Названия книг каталога: book_id → title (книга могла быть удалена — id).
    let titles: std::collections::HashMap<String, String> = st
        .db
        .all_books_access()
        .unwrap_or_default()
        .into_iter()
        .map(|b| (b.book.id.clone(), b.book.title))
        .collect();
    let mut rows: Vec<ClassProgressRow> = Vec::new();
    for s in students {
        let progress = st.db.user_progress_latest(&s.id).unwrap_or_default();
        for (book_id, fraction, updated_at) in progress {
            rows.push(ClassProgressRow {
                user_id: s.id.clone(),
                full_name: s.full_name.clone(),
                book_title: titles.get(&book_id).cloned().unwrap_or_else(|| book_id.clone()),
                book_id,
                fraction,
                updated_at,
            });
        }
    }
    Json(rows).into_response()
}

// --- Заметки учителя, видимые классу ---

#[derive(Deserialize)]
struct BookQuery {
    #[serde(rename = "bookId")]
    book_id: String,
}

/// Заметки по книге, видимые текущему пользователю: ученик — заметки его
/// классов; учитель — свои + классов, которые ведёт; admin/power — все.
/// Дубли одной публикации (несколько классов) схлопываются.
async fn get_class_notes(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<BookQuery>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    let notes = match st.db.class_notes_by_book(&q.book_id) {
        Ok(v) => v,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let visible: Vec<ClassNote> = notes
        .into_iter()
        .filter(|n| match me.role {
            Role::Admin | Role::Power => true,
            Role::Teacher => n.created_by == me.id || me.classes.contains(&n.class_id),
            Role::Student => me.classes.contains(&n.class_id),
        })
        .filter(|n| seen.insert((n.created_by.clone(), n.cfi.clone())))
        .collect();
    Json(visible).into_response()
}

/// Опубликовать заметку классам. Права: admin/power — любые классы;
/// учитель — только свои (can_manage_class). Одна строка на класс.
async fn post_class_note(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<ClassNoteReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active || me.role == Role::Student {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    if req.cfi.trim().is_empty() || req.class_ids.is_empty() {
        return (StatusCode::BAD_REQUEST, "Некорректная форма").into_response();
    }
    for class_id in &req.class_ids {
        if !can_manage_class(&me, class_id) {
            return (StatusCode::FORBIDDEN, "Нет прав на этот класс").into_response();
        }
    }
    for class_id in &req.class_ids {
        let note = ClassNote {
            id: uuid::Uuid::new_v4().to_string(),
            book_id: req.book_id.clone(),
            class_id: class_id.clone(),
            cfi: req.cfi.clone(),
            text: req.text.clone(),
            note: req.note.clone(),
            color: req.color.clone(),
            created_by: me.id.clone(),
            author_name: me.full_name.clone(),
            updated_at: now_ms(),
        };
        if st.db.create_class_note(&note).is_err() {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    st.db.log_audit(&me.full_name, "class_note", &req.book_id);
    StatusCode::NO_CONTENT.into_response()
}

/// Убрать заметку (у всех классов одной публикации). Автор или admin/power.
async fn delete_class_note_handler(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    let note = match st.db.class_note_by_id(&id) {
        Ok(Some(n)) => n,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let allowed = matches!(me.role, Role::Admin | Role::Power) || note.created_by == me.id;
    if !allowed {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    match st.db.delete_class_note(&id) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// --- Квизы от учителя ---

/// Убрать правильные ответы из вопросов (для выдачи ученику).
fn quiz_public_questions(q: &Quiz) -> Vec<QuizQuestionPublic> {
    q.questions
        .iter()
        .map(|x| QuizQuestionPublic { q: x.q.clone(), options: x.options.clone() })
        .collect()
}

/// Список квизов. Ученик — квизы его классов БЕЗ правильных ответов (+свой
/// результат); учитель — свои и своих классов (с ответами); admin/power — все.
async fn list_quizzes_handler(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active {
        return StatusCode::FORBIDDEN.into_response();
    }
    let all = match st.db.list_quizzes() {
        Ok(v) => v,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    match me.role {
        Role::Student => {
            let list: Vec<QuizForStudent> = all
                .into_iter()
                .filter(|q| me.classes.contains(&q.class_id))
                .map(|q| {
                    let my = st.db.quiz_result_for(&q.id, &me.id).ok().flatten();
                    QuizForStudent {
                        questions: quiz_public_questions(&q),
                        id: q.id,
                        book_id: q.book_id,
                        book_title: q.book_title,
                        class_id: q.class_id,
                        title: q.title,
                        my_score: my.map(|x| x.0),
                        my_total: my.map(|x| x.1),
                    }
                })
                .collect();
            Json(list).into_response()
        }
        Role::Teacher => {
            let list: Vec<Quiz> = all
                .into_iter()
                .filter(|q| q.created_by == me.id || me.classes.contains(&q.class_id))
                .collect();
            Json(list).into_response()
        }
        Role::Admin | Role::Power => Json(all).into_response(),
    }
}

/// Создать квиз. Права: can_manage_class. Валидация вопросов — на сервере.
async fn create_quiz_handler(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<QuizReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !can_manage_class(&me, &req.class_id) {
        return (StatusCode::FORBIDDEN, "Нет прав на этот класс").into_response();
    }
    if req.questions.is_empty() || req.questions.len() > 100 {
        return (StatusCode::BAD_REQUEST, "Нужен хотя бы один вопрос").into_response();
    }
    for q in &req.questions {
        if q.q.trim().is_empty() || q.options.len() < 2 || q.options.len() > 6
            || q.correct >= q.options.len()
            || q.options.iter().any(|o| o.trim().is_empty())
        {
            return (StatusCode::BAD_REQUEST, "Некорректный вопрос").into_response();
        }
    }
    // Название книги — из каталога (если книга указана).
    let book_title = if req.book_id.is_empty() {
        String::new()
    } else {
        st.db
            .all_books_access()
            .unwrap_or_default()
            .into_iter()
            .find(|b| b.book.id == req.book_id)
            .map(|b| b.book.title)
            .unwrap_or_default()
    };
    let quiz = Quiz {
        id: uuid::Uuid::new_v4().to_string(),
        book_id: req.book_id,
        book_title,
        class_id: req.class_id,
        title: if req.title.trim().is_empty() { "Квиз".to_string() } else { req.title.trim().to_string() },
        questions: req.questions,
        created_by: me.id.clone(),
        created_at: now_ms(),
    };
    match st.db.create_quiz(&quiz) {
        Ok(()) => {
            st.db.log_audit(&me.full_name, "quiz_create", &quiz.title);
            Json(quiz).into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Удалить квиз (автор или admin/power).
async fn delete_quiz_handler(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(q)) = st.db.quiz_by_id(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let allowed = me.status == UserStatus::Active
        && (matches!(me.role, Role::Admin | Role::Power) || q.created_by == me.id);
    if !allowed {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    match st.db.delete_quiz(&id) {
        Ok(true) => {
            st.db.log_audit(&me.full_name, "quiz_delete", &q.title);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Сдать ответы (ученик своего класса). Проверка — на сервере: правильные
/// ответы ученику не отдаются. Пересдача перезаписывает результат.
async fn submit_quiz_result(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<QuizAnswersReq>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(quiz)) = st.db.quiz_by_id(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if me.status != UserStatus::Active
        || me.role != Role::Student
        || !me.classes.contains(&quiz.class_id)
    {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    if req.answers.len() != quiz.questions.len() {
        return (StatusCode::BAD_REQUEST, "Ответьте на все вопросы").into_response();
    }
    let per_question: Vec<bool> = quiz
        .questions
        .iter()
        .zip(req.answers.iter())
        .map(|(q, a)| *a == q.correct)
        .collect();
    let score = per_question.iter().filter(|x| **x).count() as i64;
    let total = quiz.questions.len() as i64;
    let answers_json = serde_json::to_string(&req.answers).unwrap_or_else(|_| "[]".into());
    if st.db.upsert_quiz_result(&id, &me.id, score, total, &answers_json).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    Json(QuizScore { score, total, per_question }).into_response()
}

/// Результаты квиза по ученикам (учитель класса/автор/admin/power).
async fn quiz_results_handler(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let Ok(Some(quiz)) = st.db.quiz_by_id(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let allowed = me.status == UserStatus::Active
        && (can_manage_class(&me, &quiz.class_id) || quiz.created_by == me.id);
    if !allowed {
        return (StatusCode::FORBIDDEN, "Недостаточно прав").into_response();
    }
    match st.db.quiz_results(&id) {
        Ok(rows) => Json(rows).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// --- Офлайн-словарь ---

/// Отдать словарный пак `library/_dict/<lang>.json` (или .json.gz с
/// Content-Encoding: gzip). Пак кладёт администратор вручную. 404 — пака нет.
async fn dict_file(State(st): State<Arc<AppState>>, Path(lang): Path<String>) -> Response {
    // Только короткий код языка — никаких путей.
    if lang.len() > 3 || !lang.chars().all(|c| c.is_ascii_lowercase()) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let dir = st.library.join("_dict");
    let gz = dir.join(format!("{lang}.json.gz"));
    if let Ok(bytes) = std::fs::read(&gz) {
        return (
            [
                (header::CONTENT_TYPE, "application/json; charset=utf-8".to_string()),
                (header::CONTENT_ENCODING, "gzip".to_string()),
                (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
            ],
            bytes,
        )
            .into_response();
    }
    match std::fs::read(dir.join(format!("{lang}.json"))) {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "application/json; charset=utf-8".to_string()),
                (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_words(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<SinceQuery>,
) -> Response {
    match st.db.words_since(&sync_scope(&st, &headers), q.since) {
        Ok(items) => Json(items).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn post_words(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(items): Json<Vec<WordSyncItem>>,
) -> StatusCode {
    match st.db.upsert_words(&sync_scope(&st, &headers), &items) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book(public: bool, owner: Option<&str>, classes: &[&str], subjects: &[&str]) -> db::BookAccess {
        db::BookAccess {
            book: Book {
                id: "b".into(),
                title: "t".into(),
                author: None,
                format: "epub".into(),
                size: 0,
                added_at: 0,
            },
            classes: classes.iter().map(|s| s.to_string()).collect(),
            subjects: subjects.iter().map(|s| s.to_string()).collect(),
            categories: vec![],
            public,
            owner_id: owner.map(|s| s.to_string()),
        }
    }

    fn user(id: &str, role: Role, classes: &[&str], subjects: &[&str]) -> User {
        User {
            id: id.into(),
            role,
            status: UserStatus::Active,
            full_name: id.into(),
            login: id.into(),
            pw_hash: "x".into(),
            subjects: subjects.iter().map(|s| s.to_string()).collect(),
            classes: classes.iter().map(|s| s.to_string()).collect(),
            created_at: 0,
            must_change_pw: false,
            token_gen: 0,
        }
    }

    #[test]
    fn private_book_hidden_from_unrelated_student() {
        // Книга 7 класса по алгебре, не public.
        let b = book(false, Some("teacher1"), &["7"], &["algebra"]);
        // Ученик 8 класса — не видит (главный баг: раньше видели все).
        assert!(!can_see(Some(&user("s8", Role::Student, &["8"], &[])), &b));
        // Ученик 7 класса — видит (его класс).
        assert!(can_see(Some(&user("s7", Role::Student, &["7"], &[])), &b));
    }

    #[test]
    fn public_book_visible_to_everyone() {
        let b = book(true, Some("teacher1"), &[], &[]);
        assert!(can_see(Some(&user("s", Role::Student, &["3"], &[])), &b));
        assert!(can_see(None, &b)); // даже без JWT (по pairing-токену)
    }

    #[test]
    fn owner_and_admin_see_own_untagged_upload() {
        // Книга без тегов и не public — приватная.
        let b = book(false, Some("teacher1"), &[], &[]);
        assert!(!can_see(Some(&user("s", Role::Student, &["7"], &[])), &b)); // ученик — нет
        assert!(!can_see(Some(&user("other", Role::Teacher, &["7"], &["algebra"])), &b)); // чужой учитель — нет
        assert!(can_see(Some(&user("teacher1", Role::Teacher, &[], &[])), &b)); // загрузивший — да
        assert!(can_see(Some(&user("a", Role::Admin, &[], &[])), &b)); // админ — да
    }

    #[test]
    fn teacher_sees_by_subject() {
        let b = book(false, Some("teacher1"), &["7"], &["physics"]);
        // Учитель физики другого класса — видит по предмету.
        assert!(can_see(Some(&user("t", Role::Teacher, &["9"], &["physics"])), &b));
    }
}
