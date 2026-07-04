<script lang="ts">
  /**
   * Локальный отчёт о прогрессе (ТЗ Часть 3, п.7 — режим учитель/родитель).
   * Только чтение, всё на устройстве, без облака. Сводка по библиотеке,
   * словам и активности чтения.
   */
  import { onMount } from 'svelte';
  import {
    listWords,
    countDueWords,
    getReadingStats,
    getDiary,
    diaryToMarkdown,
    type SavedWord,
    type ReadingStats,
    type DiaryDay,
  } from '@reader/core';
  import { books, view } from '../stores';
  import { t, tr } from '../i18n';
  import Icon from './Icon.svelte';

  let words = $state<SavedWord[]>([]);
  let due = $state(0);
  let stats = $state<ReadingStats | null>(null);
  let diary = $state<DiaryDay[]>([]);

  onMount(async () => {
    words = await listWords();
    due = await countDueWords();
    stats = getReadingStats();
    diary = getDiary();
  });

  /** Новые слова по дням — для строк дневника и экспорта. */
  const wordsByDay = $derived.by(() => {
    const m = new Map<string, number>();
    for (const w of words) {
      const d = new Date(w.addedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  });

  /** Экспорт дневника в Markdown-файл. */
  function exportDiary() {
    const md = diaryToMarkdown(diary, wordsByDay, {
      title: tr('Читательский дневник'),
      words: tr('Новые слова'),
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tr('дневник-чтения')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Метрики библиотеки по прогрессу чтения.
  const started = $derived($books.filter((b) => (b.progress ?? 0) > 0).length);
  const finished = $derived($books.filter((b) => (b.progress ?? 0) >= 0.99).length);
  const reading = $derived(started - finished);
  const avgProgress = $derived(
    $books.length
      ? Math.round(($books.reduce((s, b) => s + (b.progress ?? 0), 0) / $books.length) * 100)
      : 0,
  );

  // Слова: выучено ≈ 3+ успешных повторений подряд.
  const learned = $derived(words.filter((w) => w.reps >= 3).length);
</script>

<div class="screen">
  <header class="bar">
    <button class="icon-btn" onclick={() => view.set({ name: 'library' })} aria-label={$t('К библиотеке')}>
      <Icon name="back" />
    </button>
    <h1>{$t('Отчёт о прогрессе')}</h1>
  </header>

  <div class="body">
    <p class="note">{$t('Только на этом устройстве. Никакие данные не отправляются в сеть.')}</p>

    <section>
      <h2>{$t('Чтение')}</h2>
      <div class="cards">
        <div class="card"><span class="num">{$books.length}</span><span class="lbl">{$t('книг в библиотеке')}</span></div>
        <div class="card"><span class="num">{reading}</span><span class="lbl">{$t('читаются сейчас')}</span></div>
        <div class="card"><span class="num">{finished}</span><span class="lbl">{$t('дочитано')}</span></div>
        <div class="card"><span class="num">{avgProgress}%</span><span class="lbl">{$t('средний прогресс')}</span></div>
      </div>
    </section>

    <section>
      <h2>{$t('Словарный запас')}</h2>
      <div class="cards">
        <div class="card"><span class="num">{words.length}</span><span class="lbl">{$t('слов сохранено')}</span></div>
        <div class="card"><span class="num">{learned}</span><span class="lbl">{$t('усвоено')}</span></div>
        <div class="card"><span class="num">{due}</span><span class="lbl">{$t('к повторению')}</span></div>
      </div>
    </section>

    {#if stats}
      <section>
        <h2>{$t('Активность')}</h2>
        <div class="cards">
          <div class="card"><span class="num">{stats.streak}</span><span class="lbl">{$t('дней серия')}</span></div>
          <div class="card"><span class="num">{stats.totalDays}</span><span class="lbl">{$t('дней с чтением')}</span></div>
          <div class="card"><span class="num">{stats.readToday ? $t('Да') : $t('Нет')}</span><span class="lbl">{$t('читали сегодня')}</span></div>
        </div>
      </section>
    {/if}

    <section>
      <div class="diary-head">
        <h2>{$t('Читательский дневник')}</h2>
        {#if diary.length}
          <button class="ghost" onclick={exportDiary}>{$t('Экспорт в Markdown')}</button>
        {/if}
      </div>
      {#if diary.length === 0}
        <p class="note">{$t('Дневник заполнится сам, когда откроете книгу и почитаете.')}</p>
      {:else}
        {#each diary.slice(0, 30) as day (day.date)}
          <div class="d-day">
            <h3>{day.date}</h3>
            <ul>
              {#each day.items as it (it.bookId)}
                <li>
                  <span class="d-title">{it.title}</span>
                  <span class="d-range">
                    {it.fromPct === it.toPct ? `${it.toPct}%` : `${it.fromPct}% → ${it.toPct}%`}
                  </span>
                </li>
              {/each}
              {#if wordsByDay.get(day.date)}
                <li class="d-words">{$t('Новые слова: {0}', wordsByDay.get(day.date))}</li>
              {/if}
            </ul>
          </div>
        {/each}
      {/if}
    </section>
  </div>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .bar h1 {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text);
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    max-width: 820px;
    width: 100%;
    margin: 0 auto;
  }
  .note {
    color: var(--muted);
    font-size: 0.88rem;
    margin: 0 0 1rem;
  }
  section {
    margin-bottom: 1.5rem;
  }
  section h2 {
    font-size: 1.05rem;
    color: var(--text);
    margin: 0 0 0.6rem;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.7rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .num {
    font-size: 1.7rem;
    font-weight: 700;
    color: var(--accent);
  }
  .lbl {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .icon-btn {
    display: flex;
    padding: 6px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--border);
  }
  .diary-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    padding: 0.35rem 0.8rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .d-day {
    margin-top: 0.6rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .d-day h3 {
    margin: 0 0 0.3rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .d-day ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .d-day li {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.15rem 0;
    color: var(--text);
    font-size: 0.92rem;
  }
  .d-range {
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
  }
  .d-words {
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
