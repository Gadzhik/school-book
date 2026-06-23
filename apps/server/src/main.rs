//! Бинарь библиотечного сервера: конфиг из окружения, запуск и ожидание
//! сигнала завершения. Вся логика — в библиотеке крейта (см. `src/lib.rs`),
//! чтобы тот же сервер можно было встроить в десктоп-приложение (GUI старт/стоп).

use chitalka_server::{start, shutdown_signal, Config};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,tower_http=info")),
        )
        .init();

    let handle = match start(Config::from_env()).await {
        Ok(h) => h,
        Err(e) => {
            eprintln!("не удалось запустить сервер: {e}");
            std::process::exit(1);
        }
    };

    tracing::info!("Сервер «Читалка» доступен по адресам:");
    tracing::info!(
        "  http://{}:{}   ← для других устройств в сети",
        handle.address,
        handle.port
    );
    tracing::info!(
        "  http://localhost:{}   ← на этом компьютере",
        handle.port
    );

    // Ждём закрытие консоли/Ctrl+C и корректно гасим сервер (освобождая порт).
    shutdown_signal().await;
    handle.stop().await;
}
