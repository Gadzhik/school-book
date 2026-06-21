<script lang="ts">
  import type { Facet } from '@reader/core';
  import { books } from '../stores';
  import {
    classes,
    subjects,
    categories,
    toggleBookTagAndRefresh,
    tagBook,
    suggestWithLLM,
  } from '../classification';
  import Icon from './Icon.svelte';

  interface Props {
    bookId: string;
    onclose: () => void;
  }
  const { bookId, onclose }: Props = $props();

  const book = $derived($books.find((b) => b.id === bookId));
  let newTag = $state('');

  // Состояние запроса к локальной LLM (ТЗ 5.4 источник #3).
  let llmBusy = $state(false);
  let llmMsg = $state('');

  async function askLLM() {
    if (llmBusy) return;
    llmBusy = true;
    llmMsg = '';
    try {
      const r = await suggestWithLLM(bookId);
      if (!r.ok) llmMsg = 'ИИ недоступен. Запустите Ollama или LM Studio (настройки → ИИ-помощник).';
      else if (r.added === 0) llmMsg = 'Модель не предложила новых тегов.';
      else llmMsg = `Добавлено тегов: ${r.added}. Проверьте и поправьте.`;
    } catch {
      llmMsg = 'Не удалось обратиться к модели.';
    } finally {
      llmBusy = false;
    }
  }

  function has(facet: Facet, id: string): boolean {
    return (book?.[facet] ?? []).includes(id);
  }

  function toggle(facet: Facet, id: string) {
    void toggleBookTagAndRefresh(bookId, facet, id);
  }

  function addFreeTag() {
    const t = newTag.trim();
    if (!t || !book) return;
    const cur = book.tags ?? [];
    if (!cur.includes(t)) void tagBook(bookId, { tags: [...cur, t] });
    newTag = '';
  }

  function removeFreeTag(t: string) {
    if (!book) return;
    void tagBook(bookId, { tags: (book.tags ?? []).filter((x) => x !== t) });
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="dialog" role="dialog" aria-label="Теги книги" aria-modal="true">
  <header>
    <h2>Теги: {book?.title ?? ''}</h2>
    <button class="icon-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
  </header>

  <div class="ai">
    <button class="ai-btn" onclick={askLLM} disabled={llmBusy}>
      {llmBusy ? 'Думаю…' : 'Спросить ИИ'}
    </button>
    {#if llmMsg}<span class="ai-msg">{llmMsg}</span>{/if}
  </div>

  <section>
    <h3>Класс</h3>
    <div class="chips">
      {#each $classes as c}
        <button class="chip" class:active={has('classes', c.id)} onclick={() => toggle('classes', c.id)}>
          {c.number}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Предмет</h3>
    <div class="chips">
      {#each $subjects as s}
        <button class="chip" class:active={has('subjects', s.id)} onclick={() => toggle('subjects', s.id)}>
          {s.name}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Категория</h3>
    <div class="chips">
      {#each $categories as c}
        <button class="chip" class:active={has('categories', c.id)} onclick={() => toggle('categories', c.id)}>
          {c.name}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Свои теги</h3>
    <div class="chips">
      {#each book?.tags ?? [] as t}
        <button class="chip active" onclick={() => removeFreeTag(t)} title="Убрать">
          {t} ✕
        </button>
      {/each}
    </div>
    <div class="add">
      <input
        type="text"
        bind:value={newTag}
        placeholder="Новый тег"
        onkeydown={(e) => e.key === 'Enter' && addFreeTag()}
      />
      <button onclick={addFreeTag}>Добавить</button>
    </div>
  </section>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 40;
  }
  .dialog {
    position: fixed;
    z-index: 41;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 94vw);
    max-height: 88vh;
    overflow-y: auto;
    padding: 1rem 1.2rem 1.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.8rem;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text);
  }
  section {
    margin-bottom: 1.1rem;
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    padding: 0.35rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .chip.active {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .add {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .add input {
    flex: 1;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .add button {
    padding: 0.45rem 0.8rem;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
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
  .ai {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .ai-btn {
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--accent);
    border-radius: 8px;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .ai-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ai-msg {
    font-size: 0.82rem;
    color: var(--muted);
  }
</style>
