/**
 * Публичный API пакета @reader/core.
 * Вся бизнес-логика читалки без привязки к UI и платформе.
 */
export * from './types';
export * from './format';
export * from './storage/db';
export * from './storage/opfs';
export * from './storage/persist';
export * from './storage/library';
export * from './storage/settings';
export * from './taxonomy';
export * from './syllables';
export * from './dictionary';
export * from './words';
export * from './bookmarks';
export * from './highlights';
export * from './autotag';
export * from './llm';
export * from './readability';
export * from './stats';
