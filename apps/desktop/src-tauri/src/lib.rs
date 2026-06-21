// Точка входа Tauri-приложения. Десктоп грузит ту же web-сборку читалки;
// хранилище (IndexedDB/OPFS) работает в системном WebView без изменений ядра.

mod discovery;
mod speech;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Нативные команды: поиск серверов по mDNS (ТЗ 4.3) и системный TTS (Фаза 1).
        .invoke_handler(tauri::generate_handler![
            discovery::discover_servers,
            speech::tts_speak,
            speech::tts_stop,
            speech::tts_available,
        ])
        .run(tauri::generate_context!())
        .expect("ошибка при запуске приложения Tauri");
}
