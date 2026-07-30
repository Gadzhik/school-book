// Мобильная точка входа Tauri. Атрибут mobile_entry_point обязателен:
// нативный лаунчер (Android/iOS) вызывает именно эту функцию.
// Грузится та же web-сборка читалки; хранилище IndexedDB/OPFS работает в WebView.
//
// Нативная камера и TTS (лучшие русские голоса) подключаются здесь же через
// плагины Tauri, не затрагивая общее ядро (см. packages/adapters).
mod native_log;
mod speech;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Нативный системный TTS (Фаза 1) — фолбэк, если в WebView нет голосов.
        .invoke_handler(tauri::generate_handler![
            speech::tts_speak,
            speech::tts_stop,
            speech::tts_available,
            native_log::native_log_take,
        ])
        // Нативный журнал: паника Rust на телефоне иначе видна только через
        // adb logcat, а с файлом её заберёт веб-слой и дошлёт на сервер.
        .setup(|app| {
            use tauri::Manager as _;
            if let Ok(dir) = app.path().app_data_dir() {
                native_log::init(dir, app.package_info().version.to_string().as_str());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ошибка при запуске приложения Tauri");
}
