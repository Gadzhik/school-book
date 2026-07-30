/**
 * Публичный API пакета @reader/adapters.
 * Фаза 2.5: камера. Фаза 1: нативный TTS (Tauri).
 * Плюс забор нативного журнала оболочки (паники Rust) — см. native-log.
 */
export * from './camera';
export * from './tts/native';
export * from './native-log';
