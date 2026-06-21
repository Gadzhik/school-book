//! Нативный синтез речи (Фаза 1): системные голоса через крейт `tts`
//! (Windows SAPI/WinRT, macOS AVFoundation, Linux speech-dispatcher).
//! На вебе остаётся фолбэк Web Speech — нативный путь включается только в
//! Tauri-оболочке и graceful: ошибка → веб-клиент использует свой TTS.

use std::sync::Mutex;

use tts::Tts;

// Глобальный экземпляр синтезатора (создаётся лениво, живёт всё время).
static TTS: Mutex<Option<Tts>> = Mutex::new(None);

fn with_tts<R>(f: impl FnOnce(&mut Tts) -> Result<R, String>) -> Result<R, String> {
    let mut guard = TTS.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(Tts::default().map_err(|e| e.to_string())?);
    }
    f(guard.as_mut().unwrap())
}

/// Произнести текст системным голосом (прерывая текущее). rate 0..1 (как в web).
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
#[tauri::command]
pub fn tts_stop() -> Result<(), String> {
    with_tts(|t| t.stop().map(|_| ()).map_err(|e| e.to_string()))
}

/// Доступен ли нативный синтез речи (есть бэкенд платформы).
#[tauri::command]
pub fn tts_available() -> bool {
    Tts::default().is_ok()
}
