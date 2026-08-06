import { describe, it, expect } from 'vitest';
import { applyServerTagDelta, tagsSignature } from './storage/library';

describe('applyServerTagDelta (сверка тегов с каталогом сервера)', () => {
  it('первая сверка: берём весь набор сервера', () => {
    expect(applyServerTagDelta([], [], ['9'])).toEqual(['9']);
  });

  it('сохраняет локальные теги, которых на сервере нет', () => {
    expect(applyServerTagDelta(['7'], [], ['9']).sort()).toEqual(['7', '9']);
  });

  it('снятый вручную тег НЕ возвращается, пока сервер не менялся', () => {
    // Сервер по-прежнему отдаёт «9», но мы его уже применяли и локально сняли.
    expect(applyServerTagDelta([], ['9'], ['9'])).toEqual([]);
  });

  it('новый тег на сервере добавляется', () => {
    expect(applyServerTagDelta(['9'], ['9'], ['9', '10']).sort()).toEqual(['10', '9']);
  });

  it('снятый на сервере тег убирается и локально', () => {
    expect(applyServerTagDelta(['9', '10'], ['9', '10'], ['10'])).toEqual(['10']);
  });

  it('не плодит дубли', () => {
    expect(applyServerTagDelta(['9'], [], ['9'])).toEqual(['9']);
  });

  it('пустые/отсутствующие наборы не ломают', () => {
    expect(applyServerTagDelta(undefined, undefined, undefined)).toEqual([]);
  });
});

describe('tagsSignature', () => {
  it('не зависит от порядка значений', () => {
    expect(tagsSignature({ classes: ['9', '7'] })).toBe(tagsSignature({ classes: ['7', '9'] }));
  });

  it('пустой набор и отсутствующий — одно и то же', () => {
    expect(tagsSignature({})).toBe(tagsSignature({ classes: [], subjects: [], categories: [] }));
  });

  it('различает разные наборы', () => {
    expect(tagsSignature({ classes: ['9'] })).not.toBe(tagsSignature({ subjects: ['9'] }));
  });
});
