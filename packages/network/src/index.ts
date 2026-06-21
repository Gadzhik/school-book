/**
 * Публичный API @reader/network (Фаза 5, ТЗ Часть 4).
 * Общий код клиент-серверного режима: типы, OPDS-парсер, модели
 * синхронизации, пэйринг и клиент библиотечного сервера.
 * Модуль 1 — клиентская часть (TS). Сервер (Rust axum) — отдельный модуль.
 */
export * from './types';
export * from './opds';
export * from './sync';
export * from './discovery';
export * from './ws';
export { LibraryServerClient, type ClientOptions } from './client';
