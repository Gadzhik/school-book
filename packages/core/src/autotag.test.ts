import { describe, it, expect } from 'vitest';
import { suggestTags } from './autotag';

describe('suggestTags (эвристики 5.4)', () => {
  it('извлекает класс «7 класс» и предмет из имени файла', () => {
    const t = suggestTags({ fileName: 'Алгебра 7 класс.pdf' });
    expect(t.classes).toContain('7');
    expect(t.subjects).toContain('algebra');
  });

  it('распознаёт предмет по заголовку', () => {
    const t = suggestTags({ fileName: 'book.epub', title: 'Учебник по физике' });
    expect(t.subjects).toContain('physics');
  });

  it('FB2-жанр sci_phys → физика', () => {
    const t = suggestTags({ fileName: 'x.fb2', fb2Genres: ['sci_phys'] });
    expect(t.subjects).toContain('physics');
  });

  it('ничего не угадал — пустые наборы', () => {
    const t = suggestTags({ fileName: 'qwerty.bin' });
    expect(t.classes).toEqual([]);
    expect(t.subjects).toEqual([]);
  });
});
