//! Журнал нативной части оболочки.
//!
//! Основной журнал приложения ведёт веб-слой (`@reader/core`, logger.ts): он
//! один на веб, десктоп и Android и умеет досылать записи на школьный сервер.
//! Но паника Rust или сбой при старте оболочки до загрузки WebView туда не
//! попадут — их не видит никто. Поэтому нативная часть пишет свой короткий
//! файл `native.log` в каталоге данных приложения, а веб-слой при следующем
//! запуске забирает его командой `native_log_take` и отправляет вместе со
//! своим журналом (см. packages/adapters/src/native-log.ts).
//!
//! Внешних крейтов намеренно не добавляем: только std.

use std::io::Write as _;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// Путь файла журнала (ставится в [`init`]).
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
/// Сериализация записи: пишут и паник-хук, и обычные вызовы.
static WRITE_LOCK: Mutex<()> = Mutex::new(());
/// Больше этого размера файл не растёт — при старте лишнее отбрасываем.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Отметка времени вида `2026-07-30 15:31:02Z` (UTC, без внешних крейтов).
fn stamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let days = now.div_euclid(86_400);
    let secs_of_day = now.rem_euclid(86_400);
    // civil_from_days (Howard Hinnant): дни от 1970-01-01 → Y-M-D.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60
    )
}

/// Записать строку в журнал: в файл (если известен) и в stderr.
/// На Android stderr уходит в logcat — это второй путь достать сообщение.
pub fn line(level: &str, msg: &str) {
    let text = format!("{} [{}] {}\n", stamp(), level, msg);
    eprint!("{text}");
    let Some(path) = LOG_PATH.get() else { return };
    let _guard = WRITE_LOCK.lock();
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| f.write_all(text.as_bytes()));
}

/// Включить нативный журнал: файл в каталоге данных + перехват паник.
/// Вызывать один раз при старте оболочки (в `setup`, когда известен путь).
pub fn init(data_dir: PathBuf, app_version: &str) {
    let _ = std::fs::create_dir_all(&data_dir);
    let path = data_dir.join("native.log");
    // Файл рос бы бесконечно: если он уже большой — начинаем заново.
    if std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    let _ = LOG_PATH.set(path);

    line(
        "info",
        &format!(
            "старт оболочки: версия {app_version}, ОС {} ({})",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );

    // Паника Rust без этого хука не видна нигде: окно просто закрывается
    // (десктоп) или процесс падает (Android).
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let place = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "неизвестно".to_string());
        line("error", &format!("ПАНИКА в {place}: {info}"));
        previous(info);
    }));
}

/// Отдать накопленный нативный журнал веб-слою и очистить файл.
/// Очистка намеренная: иначе один и тот же текст улетал бы на сервер
/// при каждом запуске приложения.
#[tauri::command]
pub fn native_log_take() -> String {
    let Some(path) = LOG_PATH.get() else {
        return String::new();
    };
    let _guard = WRITE_LOCK.lock();
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let _ = std::fs::write(path, b"");
    text
}
