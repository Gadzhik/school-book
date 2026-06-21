// Мобильная точка входа Tauri. Атрибут mobile_entry_point обязателен:
// нативный лаунчер (Android/iOS) вызывает именно эту функцию.
// Грузится та же web-сборка читалки; хранилище IndexedDB/OPFS работает в WebView.
//
// Нативная камера и TTS (лучшие русские голоса) подключаются здесь же через
// плагины Tauri, не затрагивая общее ядро (см. packages/adapters).
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
        ])
        .run(tauri::generate_context!())
        .expect("ошибка при запуске приложения Tauri");
}
