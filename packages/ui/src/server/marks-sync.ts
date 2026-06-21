/**
 * Синхронизация закладок и выделений с сервером (ТЗ Часть 6, п.6.3).
 * Per-user (по JWT), дельта-обмен по метке времени, слияние LWW с тумбстоунами.
 * Нет сессии/сервера — тихо ничего не делаем.
 */
import {
  bookmarksChangedSince,
  applyBookmarkSync,
  highlightsChangedSince,
  applyHighlightSync,
  type BookmarkSyncDelta,
  type HighlightSyncDelta,
} from '@reader/core';
import type { BookmarkSyncItem, HighlightSyncItem } from '@reader/network';
import { authedClient } from './auth';

const BM_KEY = 'reader:bookmarksSync';
const HL_KEY = 'reader:highlightsSync';

function readTs(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function writeTs(key: string, ts: number): void {
  try {
    localStorage.setItem(key, String(ts));
  } catch {
    /* нет localStorage — ок */
  }
}

export interface MarksSyncResult {
  ok: boolean;
  bookmarks: { pushed: number; pulled: number };
  highlights: { pushed: number; pulled: number };
}

/** Двусторонний синк закладок и выделений. */
export async function syncMarks(): Promise<MarksSyncResult> {
  const empty = { pushed: 0, pulled: 0 };
  const client = authedClient();
  if (!client) return { ok: false, bookmarks: empty, highlights: empty };

  const startedAt = Date.now();
  try {
    // Закладки.
    const bmSince = readTs(BM_KEY);
    const bmLocal = await bookmarksChangedSince(bmSince);
    if (bmLocal.length) await client.pushBookmarks(bmLocal as BookmarkSyncItem[]);
    const bmRemote = await client.pullBookmarks(bmSince);
    await applyBookmarkSync(bmRemote as BookmarkSyncDelta[]);
    writeTs(BM_KEY, startedAt);

    // Выделения.
    const hlSince = readTs(HL_KEY);
    const hlLocal = await highlightsChangedSince(hlSince);
    if (hlLocal.length) await client.pushHighlights(hlLocal as HighlightSyncItem[]);
    const hlRemote = await client.pullHighlights(hlSince);
    await applyHighlightSync(hlRemote as HighlightSyncDelta[]);
    writeTs(HL_KEY, startedAt);

    return {
      ok: true,
      bookmarks: { pushed: bmLocal.length, pulled: bmRemote.length },
      highlights: { pushed: hlLocal.length, pulled: hlRemote.length },
    };
  } catch {
    return { ok: false, bookmarks: empty, highlights: empty };
  }
}
