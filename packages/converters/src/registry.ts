/**
 * Реестр конвертеров. Конвертеры — взаимозаменяемые плагины: при добавлении
 * нового формата достаточно зарегистрировать адаптер, не трогая импорт.
 */
import type { BookFormat } from '@reader/core';
import type { Converter } from './types';

const converters: Converter[] = [];

/** Зарегистрировать конвертер. */
export function registerConverter(c: Converter): void {
  // Защита от повторной регистрации того же адаптера.
  if (!converters.some((x) => x.name === c.name)) converters.push(c);
}

/** Найти конвертер для формата (или undefined). */
export function findConverter(format: BookFormat): Converter | undefined {
  return converters.find((c) => c.formats.includes(format));
}

/** Список зарегистрированных конвертеров (для диагностики/UI). */
export function listConverters(): readonly Converter[] {
  return converters;
}
