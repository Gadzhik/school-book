/**
 * Высокоуровневый контроллер читалки поверх <foliate-view>.
 * Создаёт элемент, открывает файл (формат foliate определяет сам),
 * применяет типографику/тему, отдаёт прогресс и оглавление.
 */
import { ensureFoliate, loadOverlayer, type OverlayerClass } from './foliate-loader';
import { WebTts, type TtsOptions, type TtsCallbacks } from './tts-web';
import type {
  EngineMetadata,
  Relocation,
  TocEntry,
  TypographyOptions,
  WordTapInfo,
  SelectionInfo,
  ScreenRect,
} from './types';

/** Минимальный интерфейс элемента <foliate-view>, который мы используем. */
interface FoliateBook {
  metadata?: Record<string, unknown>;
  toc?: TocRaw[];
  getCover?: () => Promise<Blob | null>;
  dir?: string;
  rendition?: { spread?: string; layout?: string; viewport?: unknown };
}

interface FoliateView extends HTMLElement {
  open(file: File | Blob): Promise<void>;
  init(opts: { lastLocation?: string }): Promise<void>;
  goTo(target: string | number): Promise<void>;
  goToFraction(frac: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  /** Признак фиксированной вёрстки (PDF, pre-paginated EPUB). */
  isFixedLayout?: boolean;
  renderer: {
    setStyles?: (css: string) => void;
    setAttribute(name: string, value: string): void;
    next(): void;
    /** Только у fixed-layout: пере-собрать развороты из book. */
    open?: (book: FoliateBook) => void;
    /** Видимые документы текущей страницы (для TTS). */
    getContents?: () => { doc: Document; index: number }[];
  };
  book: FoliateBook;
  /** CFI для диапазона выделения в секции index. */
  getCFI(index: number, range: Range): string;
  /** Нарисовать аннотацию (выделение) по её CFI. */
  addAnnotation(annotation: { value: string; color?: string }, remove?: boolean): Promise<unknown>;
  /** Убрать аннотацию по CFI. */
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
  destroy?: () => void;
}

interface TocRaw {
  label?: string | Record<string, string>;
  href?: string;
  subitems?: TocRaw[];
}

export interface ReaderCallbacks {
  /** Вызывается при смене позиции (для сохранения прогресса). */
  onRelocate?: (loc: Relocation) => void;
  /** Вызывается, когда метаданные книги доступны. */
  onMetadata?: (meta: EngineMetadata) => void;
  /** Вызывается при тапе по слову (словарь по тапу). */
  onWordTap?: (info: WordTapInfo) => void;
  /** Вызывается при выделении фрагмента текста (помощник чтения). null — снято. */
  onSelection?: (info: SelectionInfo | null) => void;
  /** Вертикальная позиция курсора в книге (для линейки чтения), коорд. окна. */
  onPointerY?: (y: number) => void;
  /** Клик по существующему выделению (передаётся его CFI). */
  onHighlightClick?: (cfi: string) => void;
}

// Шрифт OpenDyslexic для дислексия-режима. Отдаётся приложением из /fonts.
// Подключаем внутри документа книги, иначе iframe его не увидит.
const DYSLEXIC_FONT_FACE = `
  @font-face {
    font-family: 'OpenDyslexic';
    src: url('/fonts/OpenDyslexic-Regular.woff2') format('woff2');
    font-weight: 400; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: 'OpenDyslexic';
    src: url('/fonts/OpenDyslexic-Bold.woff2') format('woff2');
    font-weight: 700; font-style: normal; font-display: swap;
  }
  @font-face {
    font-family: 'OpenDyslexic';
    src: url('/fonts/OpenDyslexic-Italic.woff2') format('woff2');
    font-weight: 400; font-style: italic; font-display: swap;
  }
`;

/** Сборка CSS для содержимого книги из настроек типографики/темы. */
function buildCSS(t: TypographyOptions): string {
  return `
    ${DYSLEXIC_FONT_FACE}
    html {
      color-scheme: ${t.background === '#000000' || t.color === '#e8e8e8' ? 'dark' : 'light'};
      color: ${t.color} !important;
      background: ${t.background} !important;
      font-size: ${t.fontSize}% !important;
      font-family: ${t.fontFamily} !important;
    }
    body {
      color: ${t.color} !important;
      background: ${t.background} !important;
      font-family: ${t.fontFamily} !important;
    }
    p, li, blockquote, dd, div, span {
      line-height: ${t.lineHeight} !important;
    }
    p, li, blockquote, dd {
      text-align: ${t.justify ? 'justify' : 'start'};
      -webkit-hyphens: auto;
      hyphens: auto;
    }
    a, a:link { color: ${t.link} !important; }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    ${
      t.eink
        ? '*, *::before, *::after { transition: none !important; animation: none !important; }'
        : ''
    }
  `;
}

function flattenToc(items: TocRaw[] | undefined, level = 0, acc: TocEntry[] = []): TocEntry[] {
  if (!items) return acc;
  for (const it of items) {
    const label =
      typeof it.label === 'string'
        ? it.label
        : it.label
          ? Object.values(it.label)[0]
          : '';
    if (it.href) acc.push({ label: label || '—', href: it.href, level });
    if (it.subitems) flattenToc(it.subitems, level + 1, acc);
  }
  return acc;
}

/** Слово под точкой (x,y) в документе книги + его диапазон. */
function wordAtPoint(
  doc: Document,
  x: number,
  y: number,
): { text: string; range: Range } | null {
  let range: Range | null = null;
  const d = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretRangeFromPoint) {
    range = d.caretRangeFromPoint(x, y);
  } else if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) {
      range = doc.createRange();
      range.setStart(p.offsetNode, p.offset);
    }
  }
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType !== 3) return null;
  const text = node.nodeValue ?? '';
  const off = range.startOffset;
  const lang = doc.documentElement.lang || 'ru';
  let seg: Intl.Segmenter;
  try {
    seg = new Intl.Segmenter(lang, { granularity: 'word' });
  } catch {
    seg = new Intl.Segmenter('ru', { granularity: 'word' });
  }
  for (const s of seg.segment(text)) {
    if (s.isWordLike && off >= s.index && off <= s.index + s.segment.length) {
      const r = doc.createRange();
      r.setStart(node, s.index);
      r.setEnd(node, s.index + s.segment.length);
      return { text: s.segment, range: r };
    }
  }
  return null;
}

/** Прямоугольник диапазона в координатах внешнего окна (учёт iframe). */
function absRect(range: Range, doc: Document): ScreenRect {
  const r = range.getBoundingClientRect();
  const fe = doc.defaultView?.frameElement as Element | null;
  const fr = fe ? fe.getBoundingClientRect() : ({ left: 0, top: 0 } as DOMRect);
  return {
    x: r.left + fr.left,
    y: r.top + fr.top,
    left: r.left + fr.left,
    right: r.right + fr.left,
    top: r.top + fr.top,
    bottom: r.bottom + fr.top,
    width: r.width,
    height: r.height,
  };
}

function readContributor(x: unknown): string | undefined {
  if (!x) return undefined;
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(readContributor).filter(Boolean).join(', ');
  const obj = x as { name?: unknown };
  if (obj.name) return readContributor(obj.name);
  const vals = Object.values(x as Record<string, unknown>);
  return vals.length ? String(vals[0]) : undefined;
}

/** Контроллер открытой книги. */
export class ReaderController {
  #view: FoliateView | null = null;
  #typography: TypographyOptions | null = null;
  #cb: ReaderCallbacks;
  #container: HTMLElement;
  /** PDF и pre-paginated EPUB: фиксированная вёрстка, своя логика отображения. */
  #fixedLayout = false;
  /** Рендерить ли формулы (KaTeX) в загружаемых документах. */
  #mathEnabled = true;
  /** Веб-TTS контроллер (создаётся лениво). */
  #tts: WebTts | null = null;
  /** Флаг остановки цикла озвучивания по страницам. */
  #ttsStopped = false;
  /** Документы, к которым уже привязан обработчик тапа по слову. */
  #tappedDocs = new WeakSet<Document>();
  /** Класс Overlayer (рисование выделений), грузится лениво. */
  #overlayer: OverlayerClass | null = null;
  /** Сохранённые выделения {cfi → цвет} для перерисовки при смене секции. */
  #highlights = new Map<string, string | undefined>();

  constructor(container: HTMLElement, callbacks: ReaderCallbacks = {}) {
    this.#container = container;
    this.#cb = callbacks;
  }

  /** Открыть файл книги. lastLocation — сохранённый CFI для восстановления. */
  async open(file: File | Blob, lastLocation?: string): Promise<void> {
    await ensureFoliate();
    this.#overlayer = await loadOverlayer();
    this.destroy();

    const view = document.createElement('foliate-view') as FoliateView;
    view.style.width = '100%';
    view.style.height = '100%';
    this.#container.append(view);
    this.#view = view;

    await view.open(file);

    // Фиксированная вёрстка (PDF): по умолчанию foliate показывает разворот
    // из двух страниц — на широком экране это мелко. Принудительно делаем
    // одну страницу за раз (spread='none') и масштаб по ширине.
    this.#fixedLayout = view.isFixedLayout === true;
    if (this.#fixedLayout && view.renderer.open) {
      view.book.rendition = { ...(view.book.rendition ?? {}), spread: 'none' };
      view.renderer.open(view.book); // пере-собрать развороты как одиночные
    }

    // Тап по слову → словарь. Привязываем к каждому загруженному документу.
    view.addEventListener('load', (e: Event) => {
      const doc = (e as CustomEvent).detail?.doc as Document | undefined;
      if (doc) {
        this.#attachWordTap(doc);
        void this.#renderMath(doc);
      }
    });

    // Рисование выделений: foliate просит нарисовать аннотацию — рисуем подсветку.
    view.addEventListener('draw-annotation', (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        draw: (fn: unknown, opts?: unknown) => void;
        annotation: { color?: string };
      };
      const color = detail.annotation.color || '#ffd54f';
      detail.draw(this.#overlayer?.highlight, { color });
    });

    // Клик по существующему выделению → отдаём его CFI (для попапа заметки).
    view.addEventListener('show-annotation', (e: Event) => {
      const value = (e as CustomEvent).detail?.value as string | undefined;
      if (value) this.#cb.onHighlightClick?.(value);
    });

    // Новая секция получила оверлей — перерисовываем сохранённые выделения.
    view.addEventListener('create-overlay', () => {
      for (const [cfi, color] of this.#highlights) {
        void view.addAnnotation({ value: cfi, color });
      }
    });

    view.addEventListener('relocate', (e: Event) => {
      const d = (e as CustomEvent).detail as {
        fraction?: number;
        cfi?: string;
        tocItem?: { label?: string };
      };
      this.#cb.onRelocate?.({
        fraction: d.fraction ?? 0,
        cfi: d.cfi,
        tocLabel: d.tocItem?.label,
      });
    });

    if (this.#typography) this.#applyStyles();

    // init сам показывает первую страницу либо восстанавливает позицию
    // (lastLocation). Повторный next() здесь не нужен — давал двойной прыжок.
    await view.init({ lastLocation });

    this.#emitMetadata();
  }

  #emitMetadata(): void {
    if (!this.#view || !this.#cb.onMetadata) return;
    const md = this.#view.book.metadata ?? {};
    const meta: EngineMetadata = {
      title: readContributor((md as Record<string, unknown>).title),
      author: readContributor((md as Record<string, unknown>).author),
      language: readContributor((md as Record<string, unknown>).language),
    };
    this.#cb.onMetadata(meta);
    // Обложка загружается асинхронно.
    this.#view.book.getCover?.().then((blob) => {
      if (blob && this.#cb.onMetadata) {
        const reader = new FileReader();
        reader.onload = () =>
          this.#cb.onMetadata?.({ ...meta, cover: reader.result as string });
        reader.readAsDataURL(blob);
      }
    });
  }

  /** Включить/выключить рендер формул (применяется к новым документам). */
  setMath(enabled: boolean): void {
    this.#mathEnabled = enabled;
  }

  /** Подключить CSS KaTeX внутрь документа книги (однократно). */
  #injectKatexCss(doc: Document): void {
    if (doc.querySelector('link[data-katex]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/katex/katex.min.css';
    link.dataset.katex = '1';
    (doc.head ?? doc.documentElement).append(link);
  }

  /**
   * Отрендерить LaTeX-формулы в документе через KaTeX (ТЗ Часть 3 п.3).
   * MathML (`<math>`) рендерит сам браузер — трогаем только TeX-делимитеры.
   * KaTeX грузим лениво и лишь если на странице есть похожее на формулы.
   */
  async #renderMath(doc: Document): Promise<void> {
    if (!this.#mathEnabled || !doc.body) return;
    const text = doc.body.textContent ?? '';
    const hasTex = /\$[^$\n]+\$|\\\(|\\\[|\\begin\{/.test(text);
    if (!hasTex) return;
    try {
      this.#injectKatexCss(doc);
      const render = (await import('katex/contrib/auto-render')).default;
      render(doc.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      });
    } catch {
      /* формулы не критичны — книга читается и без рендера */
    }
  }

  /** Привязать обработчики тапа по слову и движения курсора (однократно). */
  #attachWordTap(doc: Document): void {
    if (this.#tappedDocs.has(doc)) return;
    this.#tappedDocs.add(doc);

    if (this.#cb.onWordTap) {
      doc.addEventListener('click', (ev: MouseEvent) => {
        // Не мешаем выделению текста.
        if (doc.getSelection?.()?.toString()) return;
        const found = wordAtPoint(doc, ev.clientX, ev.clientY);
        if (!found) return;
        this.#cb.onWordTap?.({ word: found.text, rect: absRect(found.range, doc) });
      });
    }

    if (this.#cb.onSelection) {
      // После выделения фрагмента — отдаём текст и рамку для попапа помощника.
      doc.addEventListener('mouseup', () => {
        const sel = doc.getSelection?.();
        const text = sel?.toString().trim() ?? '';
        if (text.length >= 2 && sel && sel.rangeCount > 0) {
          this.#cb.onSelection?.({ text, rect: absRect(sel.getRangeAt(0), doc) });
        } else {
          this.#cb.onSelection?.(null);
        }
      });
    }

    if (this.#cb.onPointerY) {
      const fe = () => doc.defaultView?.frameElement as Element | null;
      doc.addEventListener('pointermove', (ev: MouseEvent) => {
        const top = fe()?.getBoundingClientRect().top ?? 0;
        this.#cb.onPointerY?.(ev.clientY + top);
      });
    }
  }

  #applyStyles(): void {
    if (!this.#view || !this.#typography) return;
    const t = this.#typography;

    if (this.#fixedLayout) {
      // PDF/pre-paginated: текст не перетекает, типографика неприменима.
      // Одна колонка → по ширине экрана (крупно); две → вписать страницу целиком.
      this.#view.renderer.setAttribute(
        'zoom',
        t.maxColumns === 1 ? 'fit-width' : 'fit-page',
      );
      return;
    }

    this.#view.renderer.setStyles?.(buildCSS(t));
    this.#view.renderer.setAttribute('flow', t.flow);
    this.#view.renderer.setAttribute('gap', `${t.margin}%`);
    // Одна колонка = шире и крупнее текст; не дробим разворот на широком экране.
    this.#view.renderer.setAttribute('max-column-count', String(t.maxColumns));
    this.#view.renderer.setAttribute('max-inline-size', t.maxColumns === 1 ? '52em' : '40em');
  }

  /** Фиксированная ли вёрстка у открытой книги (PDF/pre-paginated). */
  get isFixedLayout(): boolean {
    return this.#fixedLayout;
  }

  /** Применить новые настройки типографики/темы. */
  setTypography(t: TypographyOptions): void {
    this.#typography = t;
    this.#applyStyles();
  }

  /** Получить плоское оглавление. */
  getToc(): TocEntry[] {
    return flattenToc(this.#view?.book.toc);
  }

  /**
   * Выборка видимого текста книги (для оценки читаемости, ТЗ Часть 3 п.4).
   * Берёт текст текущих видимых документов до maxChars символов.
   */
  sampleText(maxChars = 4000): string {
    const contents = this.#view?.renderer.getContents?.() ?? [];
    let out = '';
    for (const c of contents) {
      out += ' ' + (c.doc.body?.textContent ?? '');
      if (out.length >= maxChars) break;
    }
    return out.slice(0, maxChars).replace(/\s+/g, ' ').trim();
  }

  next(): void {
    void this.#view?.next();
  }
  prev(): void {
    void this.#view?.prev();
  }
  goLeft(): void {
    void this.#view?.goLeft();
  }
  goRight(): void {
    void this.#view?.goRight();
  }
  /** Перейти по ссылке оглавления или к доле книги. */
  goTo(target: string): void {
    void this.#view?.goTo(target);
  }
  goToFraction(frac: number): void {
    void this.#view?.goToFraction(frac);
  }

  // --- Выделения (highlights) ---

  /**
   * CFI текущего выделения текста (для создания highlight). null — нет выделения.
   * Ищем выделение среди видимых документов и берём его диапазон.
   */
  getSelectionCfi(): string | null {
    const contents = this.#view?.renderer.getContents?.() ?? [];
    for (const { doc, index } of contents) {
      const sel = doc.getSelection?.();
      if (sel && sel.rangeCount > 0 && sel.toString().trim().length >= 1) {
        try {
          return this.#view!.getCFI(index, sel.getRangeAt(0));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /** Нарисовать и запомнить выделение по CFI. */
  async addHighlight(cfi: string, color?: string): Promise<void> {
    this.#highlights.set(cfi, color);
    await this.#view?.addAnnotation({ value: cfi, color });
  }

  /** Убрать выделение по CFI. */
  async removeHighlight(cfi: string): Promise<void> {
    this.#highlights.delete(cfi);
    await this.#view?.deleteAnnotation({ value: cfi });
  }

  /** Задать набор выделений (при открытии книги) и отрисовать видимые. */
  async setHighlights(items: { cfi: string; color?: string }[]): Promise<void> {
    this.#highlights.clear();
    for (const it of items) this.#highlights.set(it.cfi, it.color);
    for (const it of items) {
      try {
        await this.#view?.addAnnotation({ value: it.cfi, color: it.color });
      } catch {
        /* секция не загружена — отрисуется по create-overlay */
      }
    }
  }

  /** Снять текущее выделение текста (после создания highlight). */
  clearSelection(): void {
    const contents = this.#view?.renderer.getContents?.() ?? [];
    for (const { doc } of contents) doc.getSelection?.()?.removeAllRanges();
  }

  // --- Озвучивание (TTS) ---

  /** Доступно ли озвучивание для открытой книги (не для растрового PDF). */
  get canSpeak(): boolean {
    return !this.#fixedLayout && typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * Начать озвучивание с текущей страницы, листая дальше по мере чтения.
   * Подсветка слова — внутри tts-web. cb.onState сообщает UI о смене состояния.
   */
  async speak(
    opts: TtsOptions,
    cb: TtsCallbacks & { onState?: (s: 'playing' | 'stopped') => void } = {},
  ): Promise<void> {
    if (!this.canSpeak || !this.#view) return;
    this.#tts ??= new WebTts();
    this.#ttsStopped = false;
    cb.onState?.('playing');

    let guard = 0;
    while (!this.#ttsStopped && guard++ < 5000) {
      const contents = this.#view.renderer.getContents?.() ?? [];
      const cur = contents[0];
      if (!cur?.doc) break;
      const win = cur.doc.defaultView;
      if (!win) break;

      const reason = await this.#tts.speakDoc(cur.doc, win, opts, cb);
      if (this.#ttsStopped || reason === 'stopped') break;

      // Дочитали страницу — переходим к следующей и продолжаем.
      const prevDoc = cur.doc;
      await this.#view.next();
      await new Promise((r) => setTimeout(r, 300));
      const after = this.#view.renderer.getContents?.() ?? [];
      if (!after[0]?.doc || after[0].doc === prevDoc) break; // конец книги
    }
    cb.onState?.('stopped');
  }

  pauseSpeech(): void {
    this.#tts?.pause();
  }
  resumeSpeech(): void {
    this.#tts?.resume();
  }
  stopSpeech(): void {
    this.#ttsStopped = true;
    this.#tts?.stop();
  }

  /** Уничтожить текущий просмотр и очистить контейнер. */
  destroy(): void {
    this.stopSpeech();
    this.#highlights.clear();
    if (this.#view) {
      this.#view.destroy?.();
      this.#view.remove();
      this.#view = null;
    }
    this.#container.replaceChildren();
  }
}
