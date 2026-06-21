import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  addBookmark,
  listBookmarks,
  removeBookmark,
  applyBookmarkSync,
  bookmarksChangedSince,
} from './bookmarks';
import type { BookmarkSyncDelta } from './types';

describe('bookmarks (IndexedDB)', () => {
  it('добавляет и не дублирует по (bookId+locator)', async () => {
    const a = await addBookmark({ bookId: 'bk1', locator: 'cfi/2', label: 'Гл.1' });
    const b = await addBookmark({ bookId: 'bk1', locator: 'cfi/2', label: 'Гл.1' });
    expect(b.id).toBe(a.id);
    expect(await listBookmarks('bk1')).toHaveLength(1);
  });

  it('мягкое удаление (тумбстоун) убирает из списка', async () => {
    const m = await addBookmark({ bookId: 'bk2', locator: 'cfi/3' });
    await removeBookmark(m.id);
    expect(await listBookmarks('bk2')).toHaveLength(0);
  });

  it('applyBookmarkSync: свежая версия с сервера перезаписывает, старая — нет', async () => {
    const base = await addBookmark({ bookId: 'bk3', locator: 'cfi/4', label: 'старое' });
    const newer: BookmarkSyncDelta = {
      id: base.id,
      bookId: 'bk3',
      locator: 'cfi/4',
      label: 'новое',
      createdAt: base.createdAt,
      updatedAt: base.updatedAt + 1000,
    };
    await applyBookmarkSync([newer]);
    expect((await listBookmarks('bk3'))[0].label).toBe('новое');

    const older: BookmarkSyncDelta = { ...newer, label: 'устаревшее', updatedAt: base.updatedAt - 1000 };
    await applyBookmarkSync([older]);
    expect((await listBookmarks('bk3'))[0].label).toBe('новое');
  });

  it('bookmarksChangedSince отдаёт изменения после метки', async () => {
    const before = Date.now();
    await addBookmark({ bookId: 'bk4', locator: 'cfi/5' });
    const delta = await bookmarksChangedSince(before - 1);
    expect(delta.some((d) => d.bookId === 'bk4')).toBe(true);
  });
});
