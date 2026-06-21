/**
 * Согласие на бета-ИИ (ТЗ Часть 6 / запрос владельца). ИИ-функции помечены
 * «бета», работают через локальную модель и могут выдавать неверные ответы.
 * Перед первым использованием показываем предупреждение и запоминаем согласие.
 */
import { get } from 'svelte/store';
import { settings, patchSettings } from '../stores';

/** Открыто ли окно предупреждения. */
import { writable } from 'svelte/store';
export const llmDisclaimerOpen = writable(false);

let resolver: ((ok: boolean) => void) | null = null;

/** Включены ли ИИ-функции в настройках. */
export function llmEnabled(): boolean {
  return get(settings).llmEnabled;
}

/**
 * Проверить доступность ИИ перед действием. Возвращает true, если можно
 * выполнять (включено + согласие получено). При первом разе показывает окно
 * предупреждения и ждёт ответа пользователя.
 */
export function requestLlm(): Promise<boolean> {
  const s = get(settings);
  if (!s.llmEnabled) return Promise.resolve(false);
  if (s.llmConsent) return Promise.resolve(true);
  llmDisclaimerOpen.set(true);
  return new Promise((res) => {
    resolver = res;
  });
}

/** Пользователь принял предупреждение — запоминаем и продолжаем. */
export function acceptLlm(): void {
  patchSettings({ llmConsent: true });
  llmDisclaimerOpen.set(false);
  resolver?.(true);
  resolver = null;
}

/** Пользователь отказался — закрываем без выполнения. */
export function declineLlm(): void {
  llmDisclaimerOpen.set(false);
  resolver?.(false);
  resolver = null;
}

/** Полностью отключить ИИ-функции (из окна предупреждения). */
export function disableLlm(): void {
  patchSettings({ llmEnabled: false });
  llmDisclaimerOpen.set(false);
  resolver?.(false);
  resolver = null;
}
