# Библиотечный сервер читалки (Фаза 5, ТЗ 4.6).
# Многоэтапная сборка: компиляция в полном Rust-образе, запуск — в slim.
# Контекст сборки — каталог apps/server.

# --- Этап сборки ---
FROM rust:1-bookworm AS builder
WORKDIR /app
# Сначала только манифесты — кеш слоя зависимостей (rusqlite bundled тянет gcc,
# он есть в официальном rust-образе).
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
# Затем исходники и финальная сборка.
COPY src ./src
RUN touch src/main.rs && cargo build --release

# --- Этап запуска ---
FROM debian:bookworm-slim
# curl — только для HEALTHCHECK.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/chitalka-server /usr/local/bin/chitalka-server

# Данные монтируются наружу — переживают пересборку (ТЗ 4.6).
ENV CHITALKA_LIBRARY=/library \
    CHITALKA_DB=/data/chitalka.db \
    CHITALKA_PORT=9700
VOLUME ["/library", "/data"]
EXPOSE 9700

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:9700/status || exit 1

CMD ["chitalka-server"]
