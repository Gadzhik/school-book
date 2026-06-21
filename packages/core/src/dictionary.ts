/**
 * Локальный (офлайн) словарь по тапу (ТЗ Часть 1: «Тап по слову → определение
 * из локального словаря, без облака»).
 *
 * Архитектура: источник словаря подключаемый. Сейчас встроен небольшой
 * демонстрационный набор; полноценный офлайн-дамп (assets/dictionaries) можно
 * загрузить через registerDictionary() без изменения вызывающего кода.
 */

export interface DictEntry {
  /** Заголовочное слово. */
  word: string;
  /** Определения (один или несколько смыслов). */
  definitions: string[];
  /** Часть речи (если известна). */
  partOfSpeech?: string;
}

/** Нормализация слова для поиска: нижний регистр, ё→е, обрезка пунктуации. */
export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9-]/gi, '')
    .trim();
}

// Подключаемые источники словаря (Map: нормализованное слово → запись).
const sources: Map<string, DictEntry>[] = [];

/** Небольшой встроенный набор (демо). Заменяется/дополняется дампом. */
const SAMPLE: DictEntry[] = [
  { word: 'книга', partOfSpeech: 'сущ.', definitions: ['Печатное издание из скреплённых листов с текстом.'] },
  { word: 'солнце', partOfSpeech: 'сущ.', definitions: ['Звезда, вокруг которой вращается Земля; источник света и тепла.'] },
  { word: 'читать', partOfSpeech: 'глаг.', definitions: ['Воспринимать написанное, понимая смысл.'] },
  { word: 'школа', partOfSpeech: 'сущ.', definitions: ['Учебное заведение для получения образования.'] },
  { word: 'вода', partOfSpeech: 'сущ.', definitions: ['Прозрачная жидкость без цвета и запаха.'] },
  { word: 'друг', partOfSpeech: 'сущ.', definitions: ['Человек, близкий по духу, которому доверяешь.'] },
  { word: 'наука', partOfSpeech: 'сущ.', definitions: ['Система знаний о законах природы и общества.'] },
  { word: 'опыт', partOfSpeech: 'сущ.', definitions: ['Проверка предположения на практике; накопленные знания.'] },
];

const builtin = new Map<string, DictEntry>();
for (const e of SAMPLE) builtin.set(normalizeWord(e.word), e);
sources.push(builtin);

/**
 * Подключить дополнительный источник словаря (например, загруженный дамп).
 * Источники проверяются в порядке добавления; последний имеет приоритет.
 */
export function registerDictionary(entries: DictEntry[]): void {
  const map = new Map<string, DictEntry>();
  for (const e of entries) map.set(normalizeWord(e.word), e);
  sources.push(map);
}

/** Найти определение слова (или null). Поиск офлайн, синхронный по сути. */
export function lookupWord(raw: string): DictEntry | null {
  const key = normalizeWord(raw);
  if (!key) return null;
  // Последние источники важнее (дамп перекрывает демо).
  for (let i = sources.length - 1; i >= 0; i--) {
    const hit = sources[i].get(key);
    if (hit) return hit;
  }
  return null;
}
