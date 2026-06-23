// Точка входа Tauri-приложения. Десктоп грузит ту же web-сборку читалки;
// хранилище (IndexedDB/OPFS) работает в системном WebView без изменений ядра.

mod discovery;
mod speech;
// Встроенный сервер с GUI старт/стоп — только десктоп (см. server_ctl).
#[cfg(desktop)]
mod server_ctl;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // Нативные команды: поиск серверов по mDNS (ТЗ 4.3) и системный TTS (Фаза 1).
    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        discovery::discover_servers,
        speech::tts_speak,
        speech::tts_stop,
        speech::tts_available,
    ]);

    // На десктопе добавляем управление встроенным сервером (старт/стоп/статус).
    #[cfg(desktop)]
    let builder = builder
        .manage(server_ctl::ServerState::default())
        .invoke_handler(tauri::generate_handler![
            discovery::discover_servers,
            speech::tts_speak,
            speech::tts_stop,
            speech::tts_available,
            server_ctl::start_server,
            server_ctl::stop_server,
            server_ctl::server_status,
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("ошибка при запуске приложения Tauri");
}
