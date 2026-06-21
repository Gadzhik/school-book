/** Типы движка чтения (обёртка над foliate-js). */

/** Позиция/прогресс, приходящие из события relocate. */
export interface Relocation {
  /** Доля прочитанного во всей книге, 0..1. */
  fraction: number;
  /** CFI текущей позиции (EPUB/FB2) — для восстановления. */
  cfi?: string;
  /** Текущий пункт оглавления, если определён. */
  tocLabel?: string;
}

/** Пункт оглавления (плоский список с уровнем вложенности). */
export interface TocEntry {
  label: string;
  href: string;
  level: number;
}

/** Прямоугольник в координатах внешнего окна (для всплывающих подсказок). */
export interface ScreenRect {
  x: number;
  y: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/** Информация о тапе по слову. */
export interface WordTapInfo {
  /** Само слово. */
  word: string;
  /** Положение слова на экране. */
  rect: ScreenRect;
}

/** Информация о выделении фрагмента текста (для помощника чтения). */
export interface SelectionInfo {
  /** Выделенный текст. */
  text: string;
  /** Прямоугольник выделения на экране. */
  rect: ScreenRect;
}

/** Метаданные книги, извлечённые движком из содержимого. */
export interface EngineMetadata {
  title?: string;
  author?: string;
  language?: string;
  /** Обложка как data-URL (если есть). */
  cover?: string;
}

/** Параметры типографики/оформления, применяемые к содержимому книги. */
export interface TypographyOptions {
  /** Размер шрифта в процентах (100 = норма). */
  fontSize: number;
  /** Межстрочный интервал (множитель). */
  lineHeight: number;
  /** Ширина полей/зазора в процентах. */
  margin: number;
  /** Выравнивание по ширине. */
  justify: boolean;
  /** CSS-стек семейства шрифтов. */
  fontFamily: string;
  /** Цвет текста (для тем). */
  color: string;
  /** Цвет фона страницы книги. */
  background: string;
  /** Цвет ссылок. */
  link: string;
  /** Поток: постранично или прокруткой. */
  flow: 'paginated' | 'scrolled';
  /** Максимум колонок в постраничном режиме (1 — удобнее для чтения). */
  maxColumns: number;
  /** Режим e-ink: без анимаций/переходов в тексте (ТЗ Часть 3 п.9). */
  eink?: boolean;
}
