/**
 * Озвучивание текста (TTS) через Web Speech API с подсветкой читаемого слова
 * («караоке»). Работает по странице книги: собирает слова текущего документа,
 * проговаривает весь текст, а по событиям границ слов (onboundary) подсвечивает
 * текущее слово через CSS Custom Highlight API (без изменения DOM книги).
 *
 * Платформенная развязка (ТЗ): на вебе — этот адаптер; нативный TTS для
 * мобилок (лучшие русские голоса) подключается в Фазе 1 тем же интерфейсом.
 */

export interface TtsOptions {
  /** Скорость речи (0.5–2). */
  rate?: number;
  /** Желаемый голос (SpeechSynthesisVoice). */
  voice?: SpeechSynthesisVoice;
  /** Язык, напр. 'ru-RU'. */
  lang?: string;
}

export interface TtsCallbacks {
  /** Текущее слово (для отладки/статуса). */
  onWord?: (word: string) => void;
}

interface WordRange {
  start: number;
  end: number;
  range: Range;
}

const STYLE_ID = 'tts-highlight-style';

/** Доступен ли Web Speech API. */
export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Список доступных голосов (для выбора в UI). */
export function getVoices(): SpeechSynthesisVoice[] {
  if (!isTtsSupported()) return [];
  return window.speechSynthesis.getVoices();
}

/** Собрать слова документа: общий текст + диапазоны слов. */
function collectWords(doc: Document): { full: string; words: WordRange[] } {
  const lang = doc.documentElement.lang || 'ru';
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
  } catch {
    segmenter = new Intl.Segmenter('ru', { granularity: 'word' });
  }

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let full = '';
  const words: WordRange[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? '';
    const base = full.length;
    for (const seg of segmenter.segment(text)) {
      if (!seg.isWordLike) continue;
      const start = base + seg.index;
      const end = start + seg.segment.length;
      const range = doc.createRange();
      range.setStart(n, seg.index);
      range.setEnd(n, seg.index + seg.segment.length);
      words.push({ start, end, range });
    }
    full += text;
  }
  return { full, words };
}

/** Внедрить стиль подсветки в документ книги (однократно). */
function ensureHighlightStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `::highlight(tts){ background-color:#ffd54f; color:#111; }`;
  doc.head?.append(style) ?? doc.documentElement.append(style);
}

/** Контроллер веб-TTS для одного документа за раз. */
export class WebTts {
  #synth: SpeechSynthesis | null = null;
  #current: SpeechSynthesisUtterance | null = null;
  #highlight: unknown = null; // Highlight из реалма iframe
  #win: (Window & typeof globalThis) | null = null;
  #stopped = false;

  /**
   * Озвучить документ. Возвращает причину завершения:
   * 'done' — дочитано до конца, 'stopped' — остановлено/ошибка.
   */
  speakDoc(
    doc: Document,
    win: Window,
    opts: TtsOptions,
    cb: TtsCallbacks,
  ): Promise<'done' | 'stopped'> {
    const { full, words } = collectWords(doc);
    if (!full.trim()) return Promise.resolve('done');

    ensureHighlightStyle(doc);
    this.#synth = window.speechSynthesis;
    this.#win = win as Window & typeof globalThis;
    this.#stopped = false;

    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(full);
      u.rate = opts.rate ?? 1;
      u.lang = opts.lang || doc.documentElement.lang || 'ru-RU';
      if (opts.voice) u.voice = opts.voice;

      let wi = 0;
      u.onboundary = (e: SpeechSynthesisEvent) => {
        const ci = e.charIndex ?? 0;
        while (wi < words.length && words[wi].end <= ci) wi++;
        const w = words[wi];
        if (w) {
          this.#applyHighlight(w.range);
          cb.onWord?.(w.range.toString());
        }
      };
      u.onend = () => {
        this.#clearHighlight();
        resolve(this.#stopped ? 'stopped' : 'done');
      };
      u.onerror = () => {
        this.#clearHighlight();
        resolve('stopped');
      };

      this.#current = u;
      this.#synth!.speak(u);
    });
  }

  #applyHighlight(range: Range): void {
    const win = this.#win as (Window & { CSS?: typeof CSS; Highlight?: typeof Highlight }) | null;
    if (!win?.CSS?.highlights || !win.Highlight) return;
    const HL = win.Highlight;
    let hl = this.#highlight as Highlight | null;
    if (!hl) {
      hl = new HL();
      win.CSS.highlights.set('tts', hl);
      this.#highlight = hl;
    }
    hl.clear();
    hl.add(range);
  }

  #clearHighlight(): void {
    (this.#highlight as Highlight | null)?.clear();
  }

  pause(): void {
    this.#synth?.pause();
  }
  resume(): void {
    this.#synth?.resume();
  }
  stop(): void {
    this.#stopped = true;
    this.#clearHighlight();
    this.#synth?.cancel();
  }
}
