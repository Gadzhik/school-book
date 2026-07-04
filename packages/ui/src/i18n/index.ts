/**
 * Лёгкая локализация UI (gettext-стиль): ключ словаря — русская строка
 * (русский — язык по умолчанию), словарь `en.ts` даёт английский перевод.
 * Без внешних зависимостей, работает и в Svelte-разметке, и в обычных .ts.
 *
 * Использование:
 *  - в разметке: `{$t('Настройки чтения')}` — реактивно к смене языка;
 *  - в .ts-коде: `tr('Не удалось войти')` — берёт текущий язык на момент вызова;
 *  - подстановки: `tr('Страница {0} из {1}', page, total)`.
 *
 * Выбор языка хранится в localStorage (`reader:locale`) отдельно от настроек
 * ядра, чтобы быть доступным синхронно при старте и не менять @reader/core.
 */
import { writable, derived, get } from 'svelte/store';
import { en } from './en';

export type Locale = 'ru' | 'en';

const LOCALE_KEY = 'reader:locale';

function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    if (raw === 'en' || raw === 'ru') return raw;
  } catch {
    /* нет доступа к localStorage — ок */
  }
  return 'ru';
}

/** Текущий язык интерфейса. */
export const locale = writable<Locale>(loadLocale());

locale.subscribe((l) => {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* ок */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
});

/** Сменить язык интерфейса. */
export function setLocale(l: Locale): void {
  locale.set(l);
}

/** Подстановка позиционных параметров {0}, {1}, … */
function format(s: string, args: unknown[]): string {
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, (m, i) => {
    const v = args[+i];
    return v === undefined ? m : String(v);
  });
}

/**
 * Перевести строку по текущему языку (для .ts-кода, не реактивно).
 * Нет перевода в словаре — возвращаем русский оригинал.
 */
export function tr(s: string, ...args: unknown[]): string {
  const l = get(locale);
  const out = l === 'en' ? (en[s] ?? s) : s;
  return format(out, args);
}

/** Реактивная функция перевода для Svelte-разметки: `{$t('…', a, b)}`. */
export const t = derived(
  locale,
  (l) =>
    (s: string, ...args: unknown[]): string => {
      const out = l === 'en' ? (en[s] ?? s) : s;
      return format(out, args);
    },
);
