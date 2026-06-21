/**
 * Разбивка русского слова на слоги (помощь младшим классам, ТЗ Часть 1).
 * Полностью офлайн, без словаря — эвристика по правилам школьной фонетики.
 *
 * Базовые правила:
 *  - число слогов = число гласных;
 *  - одиночная согласная между гласными отходит к следующему слогу;
 *  - в стечении согласных первая остаётся в текущем слоге, остальные — в
 *    следующем (с учётом «й» и звонких сонорных, которые тяготеют к предыдущему);
 *  - «ь», «ъ», «й» не образуют слог и примыкают к предыдущему.
 * Эвристика приблизительная — как вспомогательная подсказка, не строгий разбор.
 */

const VOWELS = new Set('аеёиоуыэюяАЕЁИОУЫЭЮЯ');
const SONORANTS = new Set('йлмнрЙЛМНР');
const SIGNS = new Set('ьъЬЪ');

function isVowel(ch: string): boolean {
  return VOWELS.has(ch);
}

/** Разбить слово на слоги. Возвращает массив слогов (или [word], если 0–1 гласных). */
export function splitSyllables(word: string): string[] {
  const chars = [...word];
  const vowelCount = chars.filter(isVowel).length;
  if (vowelCount <= 1) return [word];

  const syllables: string[] = [];
  let current = '';
  let seenVowelInCurrent = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    // Стечение гласных: каждая гласная — отдельный слог (а-ист, по-эт).
    if (isVowel(ch) && seenVowelInCurrent) {
      syllables.push(current);
      current = '';
      seenVowelInCurrent = false;
    }

    current += ch;

    if (isVowel(ch)) {
      seenVowelInCurrent = true;
      continue;
    }

    // Согласная/знак после гласной — решаем, где граница слога.
    if (seenVowelInCurrent && !SIGNS.has(ch)) {
      // Сколько согласных идёт подряд до следующей гласной.
      let j = i + 1;
      while (j < chars.length && !isVowel(chars[j])) j++;
      const isLastChunk = j >= chars.length;
      const clusterLen = j - i; // включая текущую согласную

      // «й» примыкает к предыдущему слогу (мой-ка).
      const next = chars[i + 1];
      if (next === 'й' || next === 'Й') {
        current += next;
        i++;
      }

      if (!isLastChunk) {
        if (clusterLen === 1) {
          // одиночная согласная уходит к следующему слогу
          current = current.slice(0, -1);
          syllables.push(current);
          current = ch;
          seenVowelInCurrent = false;
        } else {
          // стечение: первая остаётся здесь, остальные — дальше
          syllables.push(current);
          current = '';
          seenVowelInCurrent = false;
        }
      }
    }
  }

  if (current) {
    // Хвост без гласной приклеиваем к последнему слогу.
    if (!/[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/.test(current) && syllables.length) {
      syllables[syllables.length - 1] += current;
    } else {
      syllables.push(current);
    }
  }
  return syllables.length ? syllables : [word];
}

/** Слово со слогами через дефис (для отображения): «мо-ло-ко». */
export function hyphenateSyllables(word: string): string {
  return splitSyllables(word).join('-');
}
