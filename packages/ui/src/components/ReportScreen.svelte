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
    type SavedWord,
    type ReadingStats,
  } from '@reader/core';
  import { books, view } from '../stores';
  import Icon from './Icon.svelte';

  let words = $state<SavedWord[]>([]);
  let due = $state(0);
  let stats = $state<ReadingStats | null>(null);

  onMount(async () => {
    words = await listWords();
    due = await countDueWords();
    stats = getReadingStats();
  });

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
    <button class="icon-btn" onclick={() => view.set({ name: 'library' })} aria-label="К библиотеке">
      <Icon name="back" />
    </button>
    <h1>Отчёт о прогрессе</h1>
  </header>

  <div class="body">
    <p class="note">Только на этом устройстве. Никакие данные не отправляются в сеть.</p>

    <section>
      <h2>Чтение</h2>
      <div class="cards">
        <div class="card"><span class="num">{$books.length}</span><span class="lbl">книг в библиотеке</span></div>
        <div class="card"><span class="num">{reading}</span><span class="lbl">читаются сейчас</span></div>
        <div class="card"><span class="num">{finished}</span><span class="lbl">дочитано</span></div>
        <div class="card"><span class="num">{avgProgress}%</span><span class="lbl">средний прогресс</span></div>
      </div>
    </section>

    <section>
      <h2>Словарный запас</h2>
      <div class="cards">
        <div class="card"><span class="num">{words.length}</span><span class="lbl">слов сохранено</span></div>
        <div class="card"><span class="num">{learned}</span><span class="lbl">усвоено</span></div>
        <div class="card"><span class="num">{due}</span><span class="lbl">к повторению</span></div>
      </div>
    </section>

    {#if stats}
      <section>
        <h2>Активность</h2>
        <div class="cards">
          <div class="card"><span class="num">{stats.streak}</span><span class="lbl">дней серия</span></div>
          <div class="card"><span class="num">{stats.totalDays}</span><span class="lbl">дней с чтением</span></div>
          <div class="card"><span class="num">{stats.readToday ? 'Да' : 'Нет'}</span><span class="lbl">читали сегодня</span></div>
        </div>
      </section>
    {/if}
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
</style>
