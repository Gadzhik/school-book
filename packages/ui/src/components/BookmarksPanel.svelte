<script lang="ts">
  /** Панель закладок и заметок книги (ТЗ Часть 6, п.6.3/E3). */
  import type { Bookmark, Highlight } from '@reader/core';
  import Icon from './Icon.svelte';

  interface Props {
    bookmarks: Bookmark[];
    highlights?: Highlight[];
    ongoto: (locator: string) => void;
    onremove: (id: string) => void;
    /** Переход к выделению по его CFI. */
    ongotoHighlight?: (cfi: string) => void;
    /** Открыть выделение (заметка/удаление). */
    onopenHighlight?: (id: string) => void;
    onclose: () => void;
  }
  const {
    bookmarks,
    highlights = [],
    ongoto,
    onremove,
    ongotoHighlight,
    onopenHighlight,
    onclose,
  }: Props = $props();
</script>

<nav class="panel" aria-label="Закладки и заметки">
  <header>
    <h2>Закладки и заметки</h2>
    <button class="icon-btn" onclick={onclose} aria-label="Закрыть">
      <Icon name="close" />
    </button>
  </header>

  <h3>Закладки</h3>
  {#if bookmarks.length === 0}
    <p class="muted">Закладок пока нет. Нажмите флажок в панели сверху, чтобы добавить.</p>
  {:else}
    <ul>
      {#each bookmarks as b (b.id)}
        <li>
          <button class="go" onclick={() => ongoto(b.locator)}>
            <span class="pct">{Math.round((b.fraction ?? 0) * 100)}%</span>
            <span class="text">
              <span class="label">{b.label || 'Закладка'}</span>
              {#if b.excerpt}<span class="excerpt">{b.excerpt}</span>{/if}
            </span>
          </button>
          <button class="icon-btn del" onclick={() => onremove(b.id)} aria-label="Удалить закладку">
            <Icon name="trash" size={18} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <h3>Выделения</h3>
  {#if highlights.length === 0}
    <p class="muted">Выделите текст в книге и нажмите «Выделить».</p>
  {:else}
    <ul>
      {#each highlights as h (h.id)}
        <li>
          <button class="go" onclick={() => ongotoHighlight?.(h.cfi)}>
            <span class="pct">{Math.round((h.fraction ?? 0) * 100)}%</span>
            <span class="text">
              <span class="label">«{h.text.length > 70 ? h.text.slice(0, 70) + '…' : h.text}»</span>
              {#if h.note}<span class="excerpt note">📝 {h.note}</span>{/if}
            </span>
          </button>
          <button
            class="icon-btn"
            onclick={() => onopenHighlight?.(h.id)}
            aria-label="Заметка/удалить выделение"
          >
            <Icon name="settings" size={18} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(360px, 92vw);
    background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.25);
    padding: 1rem 0.6rem 2rem;
    overflow-y: auto;
    z-index: 30;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.4rem 0.6rem;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text);
  }
  h3 {
    margin: 0.8rem 0.5rem 0.3rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
  }
  .note {
    font-style: normal;
  }
  .muted {
    color: var(--muted);
    padding: 0 0.5rem;
    font-size: 0.9rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: stretch;
    gap: 0.3rem;
    border-radius: 8px;
  }
  li:hover {
    background: var(--border);
  }
  .go {
    flex: 1;
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    text-align: left;
    padding: 0.55rem 0.5rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    min-width: 0;
  }
  .pct {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 0.8rem;
    min-width: 3ch;
    padding-top: 0.1rem;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .label {
    font-weight: 600;
    font-size: 0.92rem;
  }
  .excerpt {
    color: var(--muted);
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    padding: 6px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--bg);
  }
  .del {
    color: var(--muted);
  }
</style>
