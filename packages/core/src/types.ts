/**
 * Единая модель документа и общие типы ядра.
 *
 * Принцип ТЗ (ч.3, п.12): все конвертеры приводят книгу к единому
 * внутреннему представлению, а читалка знает только о нём.
 * На Фазе 0 храним оригинальный файл + метаданные; нормализация
 * содержимого добавляется в Фазе 2.
 */

/** Поддерживаемые форматы (определяются по сигнатуре файла, не по расширению). */
export type BookFormat =
  | 'epub'
  | 'fb2'
  | 'fb2.zip'
  | 'mobi'
  | 'azw3'
  | 'pdf'
  | 'cbz'
  | 'cbr'
  // Документы (нормализуются конвертерами в EPUB) — ТЗ Фаза 2.
  | 'html'
  | 'md'
  | 'txt'
  | 'docx'
  | 'rtf'
  | 'odt'
  | 'unknown';

/** Метаданные книги в библиотеке (хранятся в IndexedDB). */
export interface BookMeta {
  /** Уникальный идентификатор (генерируется при добавлении). */
  id: string;
  /** Заголовок (из метаданных книги либо из имени файла). */
  title: string;
  /** Автор(ы), если удалось определить. */
  author?: string;
  /** Язык книги (ISO-код), если известен. */
  language?: string;
  /** Определённый формат. */
  format: BookFormat;
  /** Имя исходного файла. */
  fileName: string;
  /** Размер файла в байтах. */
  size: number;
  /** Дата добавления (epoch ms). */
  addedAt: number;
  /** Дата последнего открытия (epoch ms). */
  lastOpenedAt?: number;
  /** Прогресс чтения, доля 0..1. */
  progress?: number;
  /**
   * Позиция чтения для восстановления (EPUB/FB2 — CFI-строка,
   * PDF — номер страницы как строка). Движок сам интерпретирует.
   */
  locator?: string;
  /** Обложка как data-URL (если извлечена). */
  cover?: string;
  /**
   * Идентификатор этой книги на библиотечном сервере (Фаза 5).
   * Ставится при скачивании с сервера; по нему синхронизируется прогресс
   * между устройствами («продолжить на любом устройстве», ТЗ 4.4).
   */
  serverId?: string;

  // --- Классификация (ТЗ Часть 5). Связь книга↔теги «многие-ко-многим»:
  // на книге храним массивы идентификаторов из управляемых словарей.
  // Старые книги без этих полей трактуются как пустые наборы.
  /** Категории (тип материала), id из словаря категорий. 1..N по смыслу. */
  categories?: string[];
  /** Учебные классы, id из словаря классов ('1'..'11'). 0..N. */
  classes?: string[];
  /** Предметы (ФГОС), id из словаря предметов. 0..N. */
  subjects?: string[];
  /** Свободные пользовательские теги (произвольный текст). */
  tags?: string[];
}

// --- Управляемые словари классификации (controlled vocabulary) ---

/** Группа учебных классов. */
export type ClassGroup = 'junior' | 'middle' | 'senior';

/** Запись словаря учебных классов (1–11). */
export interface ClassEntry {
  /** Идентификатор '1'..'11'. */
  id: string;
  /** Подпись («1 класс»). */
  label: string;
  /** Номер класса. */
  number: number;
  /** Группа: младшая (1–4), средняя (5–9), старшая (10–11). */
  group: ClassGroup;
}

/** Запись словаря предметов (ФГОС, редактируемый). */
export interface SubjectEntry {
  /** Стабильный идентификатор (slug). */
  id: string;
  /** Отображаемое название (можно переименовывать). */
  name: string;
}

/** Запись словаря категорий (тип материала). */
export interface CategoryEntry {
  /** Стабильный идентификатор (slug). */
  id: string;
  /** Отображаемое название. */
  name: string;
}

/** Сохранённое слово из «Мои слова» с параметрами интервального повторения. */
export interface SavedWord {
  /** Идентификатор. */
  id: string;
  /** Исходное слово (как сохранено). */
  word: string;
  /** Нормализованная форма (ключ). */
  normalized: string;
  /** Определение из словаря (если было). */
  definition?: string;
  /** Слоги (для подсказки). */
  syllables?: string;
  /** id книги, откуда сохранено (необязательно). */
  bookId?: string;
  /** Когда добавлено (epoch ms). */
  addedAt: number;
  /**
   * Когда запись последний раз изменена (epoch ms). Для синхронизации с
   * сервером по last-write-wins (Фаза 5). У старых записей = addedAt.
   */
  updatedAt?: number;
  /** Тумбстоун удаления: запись помечена удалённой (синхронизируется). */
  deleted?: boolean;
  // --- Параметры SM-2 (интервальное повторение) ---
  /** Срок следующего повторения (epoch ms). */
  due: number;
  /** Текущий интервал в днях. */
  interval: number;
  /** Лёгкость (ease factor), старт 2.5. */
  ease: number;
  /** Число успешных повторений подряд. */
  reps: number;
  /** Число «забываний». */
  lapses: number;
}

/** Оценка ответа на карточке. */
export type ReviewGrade = 'again' | 'good' | 'easy';

/**
 * Элемент синхронизации словаря «Мои слова» (Фаза 5). Минимальный набор
 * полей для обмена с сервером (LWW по updatedAt, с тумбстоунами).
 * Структурно совпадает с WordSyncItem из @reader/network.
 */
export interface WordSyncDelta {
  normalized: string;
  word: string;
  definition?: string;
  updatedAt: number;
  deleted?: boolean;
}

/**
 * Закладка в книге (ТЗ Часть 6, п.6.3). Привязана к позиции (locator) внутри
 * книги; хранится локально и синхронизируется с сервером по LWW с тумбстоунами.
 */
export interface Bookmark {
  /** Идентификатор. */
  id: string;
  /** id книги (BookMeta.id). */
  bookId: string;
  /** Позиция в книге (CFI для EPUB/FB2, номер страницы для PDF). */
  locator: string;
  /** Пользовательская подпись (необязательно). */
  label?: string;
  /** Короткая цитата с места закладки (для списка). */
  excerpt?: string;
  /** Прогресс 0..1 на момент закладки (для сортировки/показа). */
  fraction?: number;
  /** Когда создана (epoch ms). */
  createdAt: number;
  /** Когда последний раз изменена (epoch ms) — для LWW-синка. */
  updatedAt: number;
  /** Тумбстоун удаления (синхронизируется). */
  deleted?: boolean;
}

/**
 * Элемент синхронизации закладок (Фаза 5/Часть 6). Ключ синка — (bookId+locator)
 * для книг с serverId, либо id. LWW по updatedAt, с тумбстоунами.
 */
export interface BookmarkSyncDelta {
  id: string;
  bookId: string;
  locator: string;
  label?: string;
  excerpt?: string;
  fraction?: number;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/**
 * Выделение (highlight) с заметкой (ТЗ Часть 6, п.6.3/E3). Привязано к
 * диапазону текста через CFI; хранится локально и синхронизируется по LWW.
 */
export interface Highlight {
  /** Идентификатор. */
  id: string;
  /** id книги (BookMeta.id). */
  bookId: string;
  /** CFI-диапазон выделения (для перерисовки в книге). */
  cfi: string;
  /** Выделенный текст (для списка и поиска). */
  text: string;
  /** Заметка пользователя (необязательно). */
  note?: string;
  /** Цвет выделения (CSS), по умолчанию жёлтый. */
  color?: string;
  /** Прогресс 0..1 на момент выделения (для сортировки). */
  fraction?: number;
  /** Когда создано (epoch ms). */
  createdAt: number;
  /** Когда последний раз изменено (epoch ms) — для LWW-синка. */
  updatedAt: number;
  /** Тумбстоун удаления (синхронизируется). */
  deleted?: boolean;
}

/** Элемент синхронизации выделений (Часть 6, LWW по updatedAt, ключ id). */
export interface HighlightSyncDelta {
  id: string;
  bookId: string;
  cfi: string;
  text: string;
  note?: string;
  color?: string;
  fraction?: number;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Измерения классификации (для фасетного фильтра). */
export type Facet = 'categories' | 'classes' | 'subjects' | 'tags';

/**
 * Фасетный фильтр: внутри измерения — ИЛИ, между измерениями — И.
 * Пустое/отсутствующее измерение не накладывает ограничения.
 */
export interface FacetFilter {
  categories?: string[];
  classes?: string[];
  subjects?: string[];
  tags?: string[];
  /** Подстрока поиска по названию/автору. */
  query?: string;
}

/** Способ хранения бинарного содержимого книги. */
export type BlobBackend = 'opfs' | 'idb';

/** Запись о месте хранения файла книги. */
export interface BookBlobRef {
  id: string;
  backend: BlobBackend;
  /** Путь в OPFS либо ключ в IndexedDB. */
  path: string;
}

/** Тема оформления. */
export type ThemeName = 'light' | 'dark' | 'sepia' | 'high-contrast';

/** Семейство шрифтов читалки. */
export type FontFamilyChoice = 'serif' | 'sans' | 'dyslexic';

/** Выравнивание текста. */
export type TextAlign = 'start' | 'justify';

/** Режим чтения: постранично (колонки) или вертикальной прокруткой. */
export type ReadingFlow = 'paginated' | 'scrolled';

/** Число колонок на широком экране (1 — удобнее для чтения). */
export type ColumnCount = 1 | 2;

/** Настройки типографики и оформления (хранятся в IndexedDB). */
export interface ReaderSettings {
  theme: ThemeName;
  fontFamily: FontFamilyChoice;
  /** Размер шрифта в процентах от базового (100 = норма). */
  fontSize: number;
  /** Межстрочный интервал (множитель). */
  lineHeight: number;
  /** Ширина полей в процентах ширины экрана. */
  margin: number;
  textAlign: TextAlign;
  /** Режим чтения (страницы/прокрутка). */
  flow: ReadingFlow;
  /** Максимум колонок в постраничном режиме. */
  columns: ColumnCount;
  /** Линейка чтения (фокус-строка, следует за курсором). */
  readingRuler: boolean;
  /** Геймификация (серия чтения). По умолчанию выключена — ТЗ Часть 3 п.6. */
  gamification: boolean;
  /** Режим e-ink: без анимаций, резче, под электронные чернила (ТЗ Часть 3 п.9). */
  eink: boolean;
  /** Рендерить математические формулы (KaTeX/MathML), ТЗ Часть 3 п.3. */
  math: boolean;
  /** Провайдер локальной LLM (ИИ-функции). */
  llmProvider: 'ollama' | 'lmstudio';
  /** Свой базовый URL LLM (пусто — дефолт провайдера). */
  llmUrl: string;
  /** Имя модели (пусто — дефолт; у LM Studio — первая загруженная). */
  llmModel: string;
  /** Конвертировать документы через pandoc-wasm (тяжёлый), а не встроенно. */
  pandocDocs: boolean;
  /** Озвучивать системным голосом (нативный TTS в Tauri), а не Web Speech. */
  nativeTts: boolean;
}

/** Настройки по умолчанию: крупный читаемый текст, одна колонка. */
export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  fontFamily: 'serif',
  fontSize: 110,
  lineHeight: 1.5,
  margin: 6,
  textAlign: 'start',
  flow: 'paginated',
  columns: 1,
  readingRuler: false,
  gamification: false,
  eink: false,
  math: true,
  llmProvider: 'ollama',
  llmUrl: '',
  llmModel: '',
  pandocDocs: false,
  nativeTts: false,
};
