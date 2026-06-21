import { describe, it, expect } from 'vitest';
import { mergeProgress, mergeWords, liveWords } from './sync';
import type { DeviceProgress, WordSyncItem } from './types';

const prog = (deviceId: string, updatedAt: number, progress = 0.5): DeviceProgress => ({
  bookId: 'b1',
  deviceId,
  progress,
  updatedAt,
});

describe('mergeProgress (LWW)', () => {
  it('берёт более свежий по updatedAt', () => {
    const local = prog('A', 100, 0.3);
    const remote = prog('B', 200, 0.7);
    expect(mergeProgress(local, remote)).toBe(remote);
  });
  it('локальный свежее — побеждает локальный', () => {
    const local = prog('A', 300);
    const remote = prog('B', 200);
    expect(mergeProgress(local, remote)).toBe(local);
  });
  it('при равенстве меток выигрывает remote', () => {
    const local = prog('A', 100);
    const remote = prog('B', 100);
    expect(mergeProgress(local, remote)).toBe(remote);
  });
  it('один отсутствует — возвращается другой', () => {
    const remote = prog('B', 100);
    expect(mergeProgress(undefined, remote)).toBe(remote);
    expect(mergeProgress(remote, undefined)).toBe(remote);
    expect(mergeProgress(undefined, undefined)).toBeUndefined();
  });
});

const word = (normalized: string, updatedAt: number, deleted = false): WordSyncItem => ({
  normalized,
  word: normalized,
  updatedAt,
  deleted,
});

describe('mergeWords (LWW + тумбстоуны)', () => {
  it('свежая правка побеждает старую по normalized', () => {
    const merged = mergeWords([word('кот', 100)], [word('кот', 200)]);
    expect(merged.get('кот')?.updatedAt).toBe(200);
  });
  it('удаление (тумбстоун) побеждает более старую правку', () => {
    const merged = mergeWords([word('пёс', 100)], [word('пёс', 150, true)]);
    expect(merged.get('пёс')?.deleted).toBe(true);
  });
  it('возрождение свежее тумбстоуна', () => {
    const merged = mergeWords([word('лиса', 200)], [word('лиса', 100, true)]);
    expect(merged.get('лиса')?.deleted).toBe(false);
  });
  it('liveWords исключает удалённые и сортирует по-русски', () => {
    const merged = mergeWords(
      [word('яблоко', 10), word('абрикос', 10), word('банан', 10, true)],
      [],
    );
    expect(liveWords(merged).map((w) => w.word)).toEqual(['абрикос', 'яблоко']);
  });
});
