//! GUI-управление встроенным библиотечным сервером (десктоп).
//!
//! Сервер из крейта `chitalka_server` поднимается прямо в процессе приложения
//! (in-process) и управляется командами Tauri — админ/повер-юзер запускают и
//! останавливают его кнопкой, без отдельной консоли. Данные (БД, библиотека)
//! лежат в каталоге данных приложения; веб-сборка раздаётся из ресурсов, так
//! что http://localhost:<порт>/ открывает читалку/админку в браузере.
//!
//! Модуль только для десктопа (см. cfg в lib.rs) — на мобильных не компилируется.

use chitalka_server::{start, Config, ServerHandle};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

/// Состояние приложения: запущенный сервер (если есть). Хранится в Tauri-manage.
#[derive(Default)]
pub struct ServerState(pub Mutex<Option<ServerHandle>>);

/// Сводка для UI: запущен ли сервер и по какому адресу.
#[derive(Serialize)]
pub struct ServerInfo {
    pub running: bool,
    pub address: String,
    pub port: u16,
}

impl ServerInfo {
    fn stopped() -> Self {
        ServerInfo { running: false, address: String::new(), port: 0 }
    }
    fn from_handle(h: &ServerHandle) -> Self {
        ServerInfo { running: true, address: h.address.clone(), port: h.port }
    }
}

/// Текущий статус встроенного сервера.
#[tauri::command]
pub async fn server_status(state: State<'_, ServerState>) -> Result<ServerInfo, String> {
    let guard = state.0.lock().await;
    Ok(guard.as_ref().map(ServerInfo::from_handle).unwrap_or_else(ServerInfo::stopped))
}

/// Запустить встроенный сервер (идемпотентно: если уже запущен — вернёт его).
#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    state: State<'_, ServerState>,
) -> Result<ServerInfo, String> {
    let mut guard = state.0.lock().await;
    if let Some(h) = guard.as_ref() {
        return Ok(ServerInfo::from_handle(h));
    }

    // Данные сервера — в каталоге данных приложения (переживают обновления).
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;

    // Веб-сборка для раздачи UI — из ресурсов бандла (bundle.resources → web).
    let web_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|r| r.join("web"))
        .filter(|p| p.is_dir());

    let cfg = Config {
        library: base.join("library"),
        db_path: base.join("chitalka.db"),
        token: None,
        name: "Читалка".to_string(),
        explicit_port: None, // первый свободный 9700–9899
        web_dir,
        // Встроенный админ при пустой БД (для входа сразу после установки).
        admin_login: "admin".to_string(),
        admin_password: "admin".to_string(),
    };

    let handle = start(cfg).await.map_err(|e| e.to_string())?;
    let info = ServerInfo::from_handle(&handle);
    *guard = Some(handle);
    Ok(info)
}

/// Остановить встроенный сервер (освобождает порт). Идемпотентно.
#[tauri::command]
pub async fn stop_server(state: State<'_, ServerState>) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(handle) = guard.take() {
        handle.stop().await;
    }
    Ok(())
}
