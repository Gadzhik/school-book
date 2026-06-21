/**
 * Оценка читаемости текста, адаптированная под русский язык (ТЗ Часть 3, п.4).
 * Помогает пометить книгу как «сложно для этого возраста».
 *
 * Используем коэффициенты Оборневой (2006) — русская адаптация формул Флеша:
 *   FKGL_ru = 0.5·ASL + 8.4·ASW − 15.59   (примерный класс/уровень)
 *   FRE_ru  = 206.835 − 1.3·ASL − 60.1·ASW (индекс лёгкости, выше = легче)
 * где ASL — среднее число слов в предложении, ASW — среднее число слогов в слове.
 * Слог в русском приближённо считаем по числу гласных.
 */

export interface Readability {
  /** Индекс лёгкости (FRE_ru): выше — легче. */
  ease: number;
  /** Примерный учебный уровень/класс (FKGL_ru), ограничен 1..16. */
  gradeLevel: number;
  /** Короткая подпись: «Легко» / «Средне» / «Сложно». */
  label: string;
  /** Примерный школьный диапазон по возрасту. */
  ageHint: string;
}

const VOWELS = /[аеёиоуыэюя]/gi;

/** Число слогов в слове ≈ число гласных (минимум 1 для непустого слова). */
function syllables(word: string): number {
  const m = word.match(VOWELS);
  return m ? m.length : word.length > 0 ? 1 : 0;
}

/**
 * Оценить читаемость по тексту. Для коротких/пустых выборок возвращает
 * нейтральный «Средне». Текст — выборка из книги (несколько абзацев).
 */
export function readabilityScore(text: string): Readability {
  const sentences = (text.match(/[^.!?…]+[.!?…]+/g) ?? [text]).filter((s) => s.trim());
  const words = text.match(/[\p{L}\p{N}-]+/gu) ?? [];
  const wordCount = words.length;

  if (wordCount < 20) {
    return { ease: 60, gradeLevel: 6, label: 'Средне', ageHint: 'недостаточно текста для оценки' };
  }

  const sentenceCount = Math.max(1, sentences.length);
  const sylCount = words.reduce((sum, w) => sum + syllables(w), 0);
  const asl = wordCount / sentenceCount; // слов на предложение
  const asw = sylCount / wordCount; // слогов на слово

  const ease = clamp(206.835 - 1.3 * asl - 60.1 * asw, 0, 100);
  const gradeLevel = clamp(0.5 * asl + 8.4 * asw - 15.59, 1, 16);

  return { ease, gradeLevel, label: labelFor(ease), ageHint: ageHintFor(gradeLevel) };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function labelFor(ease: number): string {
  if (ease >= 70) return 'Легко';
  if (ease >= 45) return 'Средне';
  return 'Сложно';
}

function ageHintFor(grade: number): string {
  const cls = Math.round(grade);
  if (cls <= 4) return `≈ младшая школа (${clamp(cls, 1, 4)} кл.)`;
  if (cls <= 9) return `≈ средняя школа (${clamp(cls, 5, 9)} кл.)`;
  return '≈ старшая школа (10–11 кл.)';
}
