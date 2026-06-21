import { describe, it, expect } from 'vitest';
import { readabilityScore } from './readability';

describe('readabilityScore', () => {
  it('короткий текст (<20 слов) — нейтральная оценка', () => {
    const r = readabilityScore('Мама мыла раму.');
    expect(r.label).toBe('Средне');
    expect(r.ageHint).toMatch(/недостаточно/i);
  });

  it('простой длинный текст — «Легко»', () => {
    const simple = Array(15).fill('Кот и пёс гуляли в парке у дома.').join(' ');
    const r = readabilityScore(simple);
    expect(r.label).toBe('Легко');
    expect(r.gradeLevel).toBeLessThan(7);
  });

  it('сложный текст с длинными словами — труднее простого', () => {
    const hard = Array(15)
      .fill('Дифференцирование многочлена осуществляется последовательным применением правил.')
      .join(' ');
    const simple = Array(15).fill('Кот и пёс гуляли в парке у дома.').join(' ');
    expect(readabilityScore(hard).gradeLevel).toBeGreaterThan(readabilityScore(simple).gradeLevel);
  });
});
