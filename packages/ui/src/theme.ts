/**
 * Темы оформления и преобразование настроек в параметры движка.
 * Палитра применяется к «обвязке» приложения (CSS-переменные на :root)
 * и к содержимому книги (через TypographyOptions движка).
 */
import type { ReaderSettings, ThemeName, FontFamilyChoice } from '@reader/core';
import type { TypographyOptions } from '@reader/reader-engine';

export interface Palette {
  /** Фон страницы/чтения. */
  bg: string;
  /** Фон панелей (тулбар, карточки). */
  surface: string;
  /** Основной текст. */
  text: string;
  /** Приглушённый текст. */
  muted: string;
  /** Цвет ссылок. */
  link: string;
  /** Акцент (кнопки, активные элементы). */
  accent: string;
  /** Цвет текста на акценте. */
  onAccent: string;
  /** Граница. */
  border: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    bg: '#ffffff',
    surface: '#f3f4f6',
    text: '#1a1a1a',
    muted: '#6b7280',
    link: '#1565c0',
    accent: '#2563eb',
    onAccent: '#ffffff',
    border: '#e5e7eb',
  },
  dark: {
    bg: '#121212',
    surface: '#1e1e1e',
    text: '#e8e8e8',
    muted: '#9ca3af',
    link: '#90caf9',
    accent: '#3b82f6',
    onAccent: '#ffffff',
    border: '#333333',
  },
  sepia: {
    bg: '#f4ecd8',
    surface: '#ece0c8',
    text: '#5b4636',
    muted: '#8a7253',
    link: '#8a5a2b',
    accent: '#a06a2c',
    onAccent: '#fff8ec',
    border: '#d9c8a8',
  },
  'high-contrast': {
    bg: '#000000',
    surface: '#000000',
    text: '#ffffff',
    muted: '#dddddd',
    link: '#ffff00',
    accent: '#ffff00',
    onAccent: '#000000',
    border: '#ffffff',
  },
};

const FONT_STACKS: Record<FontFamilyChoice, string> = {
  serif: 'Georgia, "PT Serif", "Times New Roman", serif',
  sans: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  // OpenDyslexic подключается в Фазе 3; до этого — запасные шрифты.
  dyslexic: 'OpenDyslexic, "Comic Sans MS", "Trebuchet MS", sans-serif',
};

/** Применить палитру темы к корню документа (CSS-переменные обвязки). */
export function applyAppTheme(theme: ThemeName): void {
  const p = PALETTES[theme];
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--bg', p.bg);
  root.style.setProperty('--surface', p.surface);
  root.style.setProperty('--text', p.text);
  root.style.setProperty('--muted', p.muted);
  root.style.setProperty('--link', p.link);
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--on-accent', p.onAccent);
  root.style.setProperty('--border', p.border);
  root.style.colorScheme = theme === 'dark' || theme === 'high-contrast' ? 'dark' : 'light';
}

/** Построить параметры типографики движка из пользовательских настроек. */
export function toTypography(s: ReaderSettings): TypographyOptions {
  const p = PALETTES[s.theme];
  return {
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    margin: s.margin,
    justify: s.textAlign === 'justify',
    fontFamily: FONT_STACKS[s.fontFamily],
    color: p.text,
    background: p.bg,
    link: p.link,
    flow: s.flow,
    maxColumns: s.columns,
    eink: s.eink,
  };
}
