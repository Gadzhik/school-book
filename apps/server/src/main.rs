//! Библиотечный сервер читалки (Фаза 5, ТЗ Часть 4).
//! REST + OPDS-каталог + раздача книг с поддержкой Range, каталог в SQLite.
//! Конфигурация через переменные окружения:
//!   CHITALKA_LIBRARY — папка с книгами (по умолчанию ./library)
//!   CHITALKA_DB      — файл БД (по умолчанию ./chitalka.db)
//!   CHITALKA_TOKEN   — токен пэйринга; если задан — требуется Bearer (ТЗ 4.5)
//!   CHITALKA_NAME    — имя сервера (для /status и OPDS)
//!   CHITALKA_PORT    — порт (по умолчанию 9700, диапазон ТЗ 9700–9899)

mod auth;
mod autotag;
mod db;
mod mdns;
mod metadata;
mod models;
mod opds;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Multipart, Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use tokio::sync::broadcast;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeFile;
use tower_http::trace::TraceLayer;

use db::Db;
use models::{
    Assignment, AssignmentForStudent, AssignmentProgressReq, AssignmentReq, AuthResponse,
    BookmarkSyncItem, DeviceProgress, HighlightSyncItem, LoginReq, RegisterReq, Role, ServerStatus,
    User, UserStatus, WordSyncItem,
};

const VERSION: &str = env!("CARGO_PKG_VERSION");

struct AppState {
    db: Db,
    token: Option<String>,
    name: String,
    /// Папка библиотеки (для сохранения загружаемых книг).
    library: PathBuf,
    /// Секрет подписи JWT (персистентный, из meta-таблицы).
    jwt_secret: String,
    /// Канал живой рассылки прогресса WS-клиентам (JSON DeviceProgress).
    progress_tx: broadcast::Sender<String>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let library = PathBuf::from(env_or("CHITALKA_LIBRARY", "./library"));
    let db_path = PathBuf::from(env_or("CHITALKA_DB", "./chitalka.db"));
    let token = std::env::var("CHITALKA_TOKEN").ok().filter(|t| !t.is_empty());
    let name = env_or("CHITALKA_NAME", "Читалка");
    let port: u16 = env_or("CHITALKA_PORT", "9700").parse().unwrap_or(9700);

    std::fs::create_dir_all(&library).ok();
    let db = Db::open(&db_path).expect("не удалось открыть БД");
    match db.scan_library(&library) {
        Ok(n) => tracing::info!("каталог: добавлено {n} книг из {}", library.display()),
        Err(e) => tracing::warn!("сканирование библиотеки не удалось: {e}"),
    }

    let (progress_tx, _) = broadcast::channel::<String>(64);
    let jwt_secret = db.jwt_secret();
    let state = Arc::new(AppState {
        db,
        token,
        name,
        library: library.clone(),
        jwt_secret,
        progress_tx,
    });

    // Защищённые маршруты — под проверкой токена (если он задан).
    let protected = Router::new()
        .route("/opds", get(opds_root))
        .route("/opds/all", get(opds_all))
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
        .route("/api/users", get(list_users))
        .route("/api/users/{id}/approve", post(approve_user))
        .route("/api/users/{id}/reject", post(reject_user))
        .route("/books", post(upload_book))
        .route("/api/assignments", get(list_assignments).post(create_assignment))
        .route("/api/assignments/{id}", delete(delete_assignment))
        .route("/api/assignments/{id}/progress", post(assignment_progress))
        .route("/api/assignments/{id}/report", get(assignment_report))
        .route("/api/audit", get(get_audit))
        .route("/api/backup", get(backup))
        .route("/api/bookmarks", get(get_bookmarks).post(post_bookmarks))
        .route("/api/highlights", get(get_highlights).post(post_highlights))
        // WebSocket: токен передаётся в query (браузер не шлёт заголовки для WS).
        .route("/ws", get(ws_handler))
        // Обложка: токен в query — чтобы работало в <img src> (без заголовков).
        .route("/books/{id}/cover", get(cover))
        .merge(protected)
        .with_state(state.clone())
        // CORS — внешний слой: обрабатывает preflight до авторизации,
        // чтобы веб-клиент (другой origin) мог обращаться к серверу.
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    // mDNS-анонс для нативных клиентов (держим демон живым до завершения).
    let _mdns = match mdns::announce(&state.name, port, VERSION) {
        Ok(d) => {
            tracing::info!("mDNS: анонс _chitalka._tcp.local (порт {port})");
            Some(d)
        }
        Err(e) => {
            tracing::warn!("mDNS недоступен: {e} (используйте QR/ручной ввод)");
            None
        }
    };

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    tracing::info!("сервер слушает http://{addr}");
    axum::serve(listener, app).await.expect("serve");
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// Проверка Bearer-токена пэйринга (если CHITALKA_TOKEN задан).
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
            .unwrap_or(false);
        if !ok {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }
    Ok(next.run(req).await)
}

async fn status(State(st): State<Arc<AppState>>) -> Json<ServerStatus> {
    Json(ServerStatus {
        name: st.name.clone(),
        version: VERSION.to_string(),
        books: st.db.count_books(),
        ok: true,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Текущий пользователь из заголовка Authorization: Bearer <JWT>.
fn current_user(st: &AppState, headers: &HeaderMap) -> Option<User> {
    let auth_h = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = auth_h.strip_prefix("Bearer ")?;
    let claims = auth::verify_token(&st.jwt_secret, token)?;
    st.db.user_by_id(&claims.sub).ok().flatten()
}

/// Регистрация (ТЗ 6.2). Первый пользователь — администратор (бутстрап);
/// остальные — teacher/student со статусом «ожидает». Возвращает JWT + профиль.
async fn register(State(st): State<Arc<AppState>>, Json(req): Json<RegisterReq>) -> Response {
    if req.full_name.trim().is_empty() || req.login.trim().is_empty() || req.password.len() < 4 {
        return (
            StatusCode::BAD_REQUEST,
            "Укажите имя, логин и пароль (минимум 4 символа)",
        )
            .into_response();
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
    };

    match st.db.create_user(&user) {
        Ok(()) => {
            st.db.log_audit(
                &user.full_name,
                "register",
                &format!("{} ({})", role.as_str(), user.login),
            );
            let token = auth::issue_token(&st.jwt_secret, &user.id, role).unwrap_or_default();
            Json(AuthResponse { token, user: user.public() }).into_response()
        }
        Err(_) => (StatusCode::CONFLICT, "Логин уже занят").into_response(),
    }
}

/// Вход по логину/паролю. Возвращает JWT + профиль (даже если статус «ожидает» —
/// клиент покажет, что ждёт одобрения; права проверяются на защищённых роутах).
async fn login(State(st): State<Arc<AppState>>, Json(req): Json<LoginReq>) -> Response {
    let user = match st.db.user_by_login(req.login.trim()) {
        Ok(Some(u)) => u,
        Ok(None) => return (StatusCode::UNAUTHORIZED, "Неверный логин или пароль").into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if !auth::verify_password(&req.password, &user.pw_hash) {
        return (StatusCode::UNAUTHORIZED, "Неверный логин или пароль").into_response();
    }
    if user.status == UserStatus::Blocked {
        return (StatusCode::FORBIDDEN, "Учётная запись заблокирована").into_response();
    }
    let token = auth::issue_token(&st.jwt_secret, &user.id, user.role).unwrap_or_default();
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
    ) {
        Ok(()) => {
            st.db.log_audit(&me.full_name, "upload", &final_title);
            (StatusCode::CREATED, Json(serde_json::json!({ "id": id }))).into_response()
        }
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

/// Скачать резервную копию БД (только админ). VACUUM INTO → байты файла.
async fn backup(State(st): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(me) = current_user(&st, &headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if me.status != UserStatus::Active || me.role != Role::Admin {
        return StatusCode::FORBIDDEN.into_response();
    }
    let tmp = std::env::temp_dir().join(format!("chitalka_backup_{}.db", now_ms()));
    if st.db.backup_to(&tmp).is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let bytes = match std::fs::read(&tmp) {
        Ok(b) => b,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let _ = std::fs::remove_file(&tmp);
    st.db.log_audit(&me.full_name, "backup", "скачана резервная копия");
    (
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"chitalka-backup.db\"".to_string(),
            ),
        ],
        bytes,
    )
        .into_response()
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

/// Корневой навигационный фид (по измерениям + все книги).
async fn opds_root(State(st): State<Arc<AppState>>) -> Response {
    opds_response(opds::navigation_root(&st.name))
}

/// Acquisition-фид всех книг.
async fn opds_all(State(st): State<Arc<AppState>>) -> Response {
    match st.db.list_books() {
        Ok(books) => opds_response(opds::acquisition_feed(&st.name, &books)),
        Err(e) => {
            tracing::error!("OPDS: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// Навигационный фид со списком значений измерения.
fn dimension_feed(st: &AppState, dim: &str, title: &str) -> Response {
    match st.db.distinct_tags(dim) {
        Ok(values) => opds_response(opds::dimension_list(title, dim, &values)),
        Err(e) => {
            tracing::error!("OPDS {dim}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn opds_classes(State(st): State<Arc<AppState>>) -> Response {
    dimension_feed(&st, "class", "По классам")
}
async fn opds_subjects(State(st): State<Arc<AppState>>) -> Response {
    dimension_feed(&st, "subject", "По предметам")
}
async fn opds_categories(State(st): State<Arc<AppState>>) -> Response {
    dimension_feed(&st, "category", "По категориям")
}

/// Acquisition-фид книг с данным значением измерения.
fn tag_feed(st: &AppState, dim: &str, id: &str) -> Response {
    match st.db.books_by_tag(dim, id) {
        Ok(books) => {
            let title = format!("{} — {}", st.name, autotag::label(dim, id));
            opds_response(opds::acquisition_feed(&title, &books))
        }
        Err(e) => {
            tracing::error!("OPDS {dim}/{id}: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn opds_by_class(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    tag_feed(&st, "class", &id)
}
async fn opds_by_subject(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    tag_feed(&st, "subject", &id)
}
async fn opds_by_category(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    tag_feed(&st, "category", &id)
}

/// Раздача файла книги с поддержкой Range (докачка/перемотка — ТЗ 4.7).
async fn download(State(st): State<Arc<AppState>>, Path(id): Path<String>, req: Request) -> Response {
    let Ok(Some(path)) = st.db.book_path(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // ServeFile сам обрабатывает Range и заголовки кэширования.
    match ServeFile::new(path).oneshot(req).await {
        Ok(res) => res.map(Body::new),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Обложка книги (EPUB). Токен — в query (для <img>). 404 — если обложки нет.
async fn cover(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<WsQuery>,
) -> Response {
    if let Some(tok) = &st.token {
        if q.token.as_deref() != Some(tok.as_str()) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
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

async fn get_progress(State(st): State<Arc<AppState>>, Path(book_id): Path<String>) -> Response {
    match st.db.latest_progress(&book_id) {
        Ok(Some(p)) => Json(p).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn put_progress(
    State(st): State<Arc<AppState>>,
    Path(_book_id): Path<String>,
    Json(p): Json<DeviceProgress>,
) -> StatusCode {
    match st.db.upsert_progress(&p) {
        Ok(()) => {
            // Живая рассылка другим устройствам («продолжить везде», ТЗ 4.9.4).
            if let Ok(json) = serde_json::to_string(&p) {
                let _ = st.progress_tx.send(json);
            }
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// WebSocket живой синхронизации прогресса. Токен — в query (?token=…).
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(st): State<Arc<AppState>>,
    Query(q): Query<WsQuery>,
) -> Response {
    if let Some(tok) = &st.token {
        if q.token.as_deref() != Some(tok.as_str()) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }
    let rx = st.progress_tx.subscribe();
    ws.on_upgrade(move |socket| ws_loop(socket, rx))
}

/// Пересылаем рассылку прогресса в сокет, читаем входящие до закрытия.
async fn ws_loop(mut socket: WebSocket, mut rx: broadcast::Receiver<String>) {
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(json) => {
                    if socket.send(Message::Text(json.into())).await.is_err() {
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

async fn get_words(State(st): State<Arc<AppState>>, Query(q): Query<SinceQuery>) -> Response {
    match st.db.words_since(q.since) {
        Ok(items) => Json(items).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn post_words(
    State(st): State<Arc<AppState>>,
    Json(items): Json<Vec<WordSyncItem>>,
) -> StatusCode {
    match st.db.upsert_words(&items) {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
