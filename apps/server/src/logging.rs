//! Уровни логирования с переключением на лету (админ через /api/log-level).
//!
//! Пять уровней (лестница tracing, каждый следующий включает предыдущие):
//!   error   — только сбои: не удалась операция, ошибка БД/IO, упавшая задача;
//!   warn    — + деградации: mDNS недоступен, автобэкап не удался, подозрительные
//!             запросы; сервер работает, но что-то не так;
//!   info    — + жизненный цикл (ПО УМОЛЧАНИЮ): старт/стоп, порты, рескан нашёл
//!             книги, бэкапы, создание админа. Спокойный «журнал смены»;
//!   debug   — + события обработки: каждый HTTP-запрос (метод/путь/статус/время),
//!             входы пользователей, WS-подключения, ход автобэкапа;
//!   verbose — + максимальная детализация (trace): тела/шаги внутри обработчиков,
//!             каждое WS-сообщение, тики рескана, внутренности зависимостей.
//!
//! Выбор хранится в meta-таблице БД (`log_level`) и применяется на лету через
//! reload-хэндл tracing_subscriber. Приоритет при старте: RUST_LOG (ручная
//! отладка разработчиком) > сохранённый уровень из БД > info.

use std::sync::OnceLock;

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{reload, EnvFilter, Registry};

/// Хэндл смены фильтра на лету. Пуст, если подписчик инициализировали не мы
/// (например, сервер встроен в десктоп со своим логированием) — тогда смена
/// уровня недоступна, но настройка всё равно сохраняется в БД.
static HANDLE: OnceLock<reload::Handle<EnvFilter, Registry>> = OnceLock::new();

/// Допустимые уровни (в порядке роста детализации).
pub const LEVELS: &[&str] = &["error", "warn", "info", "debug", "verbose"];

/// Директива фильтра для уровня. None — уровень неизвестен.
/// Шумные внутренности зависимостей (hyper/h2/mdns) прижаты даже на verbose,
/// иначе полезные trace-записи сервера тонут в кадрах HTTP/2.
pub fn filter_for(level: &str) -> Option<&'static str> {
    Some(match level {
        "error" => "error",
        "warn" => "warn",
        "info" => "info,tower_http=info",
        "debug" => "info,chitalka_server=debug,tower_http=debug",
        "verbose" => {
            "debug,chitalka_server=trace,tower_http=trace,hyper=info,h2=info,mdns_sd=info"
        }
        _ => return None,
    })
}

/// Инициализировать глобальный подписчик логов с возможностью смены уровня.
/// Вызывается один раз бинарём (`main.rs`). RUST_LOG, если задан, имеет
/// высший приоритет (и тогда сохранённый в БД уровень при старте не применяется).
pub fn init_logging() {
    let initial = std::env::var("RUST_LOG")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| filter_for("info").unwrap().to_string());
    let (layer, handle) = reload::Layer::new(EnvFilter::new(initial));
    tracing_subscriber::registry()
        .with(layer)
        .with(tracing_subscriber::fmt::layer())
        .init();
    let _ = HANDLE.set(handle);
}

/// RUST_LOG задан руками → уровень из БД при старте не трогаем.
pub fn env_override_active() -> bool {
    std::env::var("RUST_LOG").map(|v| !v.trim().is_empty()).unwrap_or(false)
}

/// Применить уровень на лету. Ошибка — неизвестный уровень или подписчик
/// инициализирован не нами (встраивание в десктоп).
pub fn apply_level(level: &str) -> Result<(), String> {
    let f = filter_for(level).ok_or_else(|| format!("неизвестный уровень «{level}»"))?;
    let h = HANDLE
        .get()
        .ok_or_else(|| "логирование инициализировано не сервером (смена уровня недоступна)".to_string())?;
    h.reload(EnvFilter::new(f)).map_err(|e| e.to_string())
}
