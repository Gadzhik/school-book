//! Нативный синтез речи (Фаза 1): системные голоса через крейт `tts`
//! (Windows SAPI/WinRT, macOS AVFoundation, Linux speech-dispatcher).
//! На вебе остаётся фолбэк Web Speech — нативный путь включается только в
//! Tauri-оболочке и graceful: ошибка → веб-клиент использует свой TTS.
//!
//! Android исключён: backend крейта `tts` падает в JNI_OnLoad (ищет Java-класс
//! `rs.tts.Bridge`, которого в проекте нет) → SIGABRT при загрузке .so, т.е.
//! краш на старте. Там команды — стабы (возвращают «недоступно»), а озвучка
//! идёт через Web Speech в WebView (проксируется в системный Android TextToSpeech).
//!
//! Команды объявлены на верхнем уровне модуля (не в подмодуле): макрос
//! `#[tauri::command]` генерит вспомогательные items `__cmd__*`, которые
//! `tauri::generate_handler!` ищет именно как `speech::__cmd__*`.

#[cfg(not(target_os = "android"))]
use std::sync::Mutex;

#[cfg(not(target_os = "android"))]
use tts::Tts;

// Глобальный экземпляр синтезатора (создаётся лениво, живёт всё время).
#[cfg(not(target_os = "android"))]
static TTS: Mutex<Option<Tts>> = Mutex::new(None);

#[cfg(not(target_os = "android"))]
fn with_tts<R>(f: impl FnOnce(&mut Tts) -> Result<R, String>) -> Result<R, String> {
    let mut guard = TTS.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(Tts::default().map_err(|e| e.to_string())?);
    }
    f(guard.as_mut().unwrap())
}

/// Произнести текст системным голосом (прерывая текущее). rate 0..1 (как в web).
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn tts_speak(text: String, rate: Option<f32>) -> Result<(), String> {
    with_tts(|t| {
        if let Some(r) = rate {
            // Маппим 0..1 в поддерживаемый диапазон скорости голоса.
            let (min, normal, max) = (t.min_rate(), t.normal_rate(), t.max_rate());
            let mapped = if r < 0.5 {
                min + (normal - min) * (r / 0.5)
            } else {
                normal + (max - normal) * ((r - 0.5) / 0.5)
            };
            let _ = t.set_rate(mapped);
        }
        t.speak(text, true).map(|_| ()).map_err(|e| e.to_string())
    })
}

/// Остановить озвучивание.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn tts_stop() -> Result<(), String> {
    with_tts(|t| t.stop().map(|_| ()).map_err(|e| e.to_string()))
}

/// Доступен ли нативный синтез речи (есть бэкенд платформы).
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn tts_available() -> bool {
    Tts::default().is_ok()
}

// --- Android: стабы. Клиент при `tts_available() == false` (или ошибке speak)
//     откатывается на Web Speech в WebView.

/// Стаб: нативный синтез на Android недоступен (используется Web Speech).
#[cfg(target_os = "android")]
#[tauri::command]
pub fn tts_speak(_text: String, _rate: Option<f32>) -> Result<(), String> {
    Err("native TTS unavailable on Android; use Web Speech".into())
}

/// Стаб: нечего останавливать.
#[cfg(target_os = "android")]
#[tauri::command]
pub fn tts_stop() -> Result<(), String> {
    Ok(())
}

/// Стаб: нативный backend на Android отсутствует.
#[cfg(target_os = "android")]
#[tauri::command]
pub fn tts_available() -> bool {
    false
}
