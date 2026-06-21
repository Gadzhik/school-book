<script lang="ts">
  import { onMount } from 'svelte';
  import { type SavedWord, type ReviewGrade, wordsToCsv, wordsToMarkdown } from '@reader/core';
  import { view } from '../stores';
  import { words, dueCount, refreshWords, deleteWord, gradeWord, loadDue } from './store';
  import Icon from '../components/Icon.svelte';

  type Mode = 'list' | 'review';
  let mode = $state<Mode>('list');

  // Очередь повторения
  let queue = $state<SavedWord[]>([]);
  let pos = $state(0);
  let revealed = $state(false);
  let reviewed = $state(0);

  const card = $derived(queue[pos]);

  onMount(refreshWords);

  async function startReview() {
    queue = await loadDue();
    pos = 0;
    revealed = false;
    reviewed = 0;
    if (queue.length > 0) mode = 'review';
  }

  async function grade(g: ReviewGrade) {
    if (!card) return;
    await gradeWord(card.id, g);
    reviewed += 1;
    pos += 1;
    revealed = false;
    if (pos >= queue.length) mode = 'list';
  }

  function speak(word: string) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'ru-RU';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  /** Скачать текст файлом (ТЗ Часть 3, п.10 — экспорт для учёбы). */
  function download(content: string, fileName: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    download(wordsToCsv($words), 'мои-слова.csv', 'text/csv;charset=utf-8');
  }
  function exportMarkdown() {
    download(wordsToMarkdown($words), 'мои-слова.md', 'text/markdown;charset=utf-8');
  }
</script>

<div class="screen">
  <header class="bar">
    <button class="icon-btn" onclick={() => view.set({ name: 'library' })} aria-label="К библиотеке">
      <Icon name="back" />
    </button>
    <h1>Мои слова</h1>
    <span class="spacer"></span>
    {#if mode === 'list' && $words.length > 0}
      <button class="export-btn" onclick={exportMarkdown} title="Экспорт в Markdown">MD</button>
      <button class="export-btn" onclick={exportCsv} title="Экспорт в CSV">CSV</button>
    {/if}
    {#if mode === 'list' && $dueCount > 0}
      <button class="review-btn" onclick={startReview}>
        Повторять ({$dueCount})
      </button>
    {/if}
  </header>

  <div class="body">
    {#if mode === 'review' && card}
      <div class="card">
        <div class="front">
          <span class="word">{card.word}</span>
          <button class="icon-btn" onclick={() => speak(card.word)} aria-label="Произнести">
            <Icon name="speaker" />
          </button>
        </div>

        {#if revealed}
          <p class="syll">Слоги: <b>{card.syllables}</b></p>
          {#if card.definition}
            <p class="def">{card.definition}</p>
          {:else}
            <p class="def muted">Определение не сохранено.</p>
          {/if}
          <div class="grades">
            <button class="g again" onclick={() => grade('again')}>Не помню</button>
            <button class="g good" onclick={() => grade('good')}>Помню</button>
            <button class="g easy" onclick={() => grade('easy')}>Легко</button>
          </div>
        {:else}
          <button class="reveal" onclick={() => (revealed = true)}>Показать</button>
        {/if}

        <p class="counter">{pos + 1} / {queue.length}</p>
      </div>
    {:else}
      {#if $words.length === 0}
        <p class="empty">Пока нет сохранённых слов. Нажмите на слово в книге → «Сохранить».</p>
      {:else}
        <ul class="list">
          {#each $words as w (w.id)}
            <li>
              <div class="info">
                <span class="lw">{w.word}</span>
                <span class="ls">{w.syllables}</span>
                {#if w.definition}<span class="ld">{w.definition}</span>{/if}
              </div>
              <button class="icon-btn" onclick={() => deleteWord(w.id)} aria-label="Удалить слово">
                <Icon name="trash" size={18} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
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
  .spacer {
    flex: 1;
  }
  .review-btn {
    padding: 0.5rem 0.9rem;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .export-btn {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .export-btn:hover {
    background: var(--border);
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
  }
  .empty {
    margin-top: 2rem;
    text-align: center;
    color: var(--muted);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .lw {
    font-weight: 700;
    color: var(--text);
  }
  .ls {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .ld {
    font-size: 0.9rem;
    color: var(--text);
  }
  .card {
    margin-top: 1rem;
    padding: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--surface);
    text-align: center;
  }
  .front {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .word {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text);
  }
  .syll {
    margin: 1rem 0 0.4rem;
    color: var(--text);
  }
  .def {
    margin: 0.4rem 0 1rem;
    color: var(--text);
  }
  .def.muted {
    color: var(--muted);
  }
  .reveal {
    margin-top: 1.5rem;
    padding: 0.7rem 1.4rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-size: 1rem;
  }
  .grades {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
  .g {
    flex: 1;
    max-width: 140px;
    padding: 0.7rem;
    border: none;
    border-radius: 10px;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .g.again {
    background: #d33;
  }
  .g.good {
    background: var(--accent);
  }
  .g.easy {
    background: #2e9e5b;
  }
  .counter {
    margin: 1.2rem 0 0;
    color: var(--muted);
    font-size: 0.85rem;
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
