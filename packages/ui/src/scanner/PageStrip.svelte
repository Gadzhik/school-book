<script lang="ts">
  import type { ScanPage } from '@reader/book-scanner';
  import { pages, movePage, removePage, retakePage, scannerBusy } from './store';
  import Icon from '../components/Icon.svelte';

  // Перетаскивание: запоминаем индекс схваченной страницы.
  let dragIndex = $state<number | null>(null);

  function onDragStart(i: number) {
    dragIndex = i;
  }
  function onDropAt(i: number) {
    if (dragIndex !== null && dragIndex !== i) movePage(dragIndex, i);
    dragIndex = null;
  }
</script>

<div class="strip" role="list" aria-label="Страницы книги">
  {#each $pages as page, i (page.id)}
    <div
      class="page"
      role="listitem"
      draggable={!$scannerBusy}
      ondragstart={() => onDragStart(i)}
      ondragover={(e) => e.preventDefault()}
      ondrop={() => onDropAt(i)}
    >
      <span class="num">{i + 1}</span>
      <img src={page.thumb} alt={`Страница ${i + 1}`} />
      <div class="tools">
        <button
          title="Вверх"
          disabled={$scannerBusy || i === 0}
          onclick={() => movePage(i, i - 1)}
          aria-label="Переместить вверх"
        >
          <Icon name="prev" size={16} />
        </button>
        <button
          title="Вниз"
          disabled={$scannerBusy || i === $pages.length - 1}
          onclick={() => movePage(i, i + 1)}
          aria-label="Переместить вниз"
        >
          <Icon name="next" size={16} />
        </button>
        <button
          title="Переснять"
          disabled={$scannerBusy}
          onclick={() => retakePage(page.id)}
          aria-label="Переснять страницу"
        >
          <Icon name="settings" size={16} />
        </button>
        <button
          class="del"
          title="Удалить"
          disabled={$scannerBusy}
          onclick={() => removePage(page.id)}
          aria-label="Удалить страницу"
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  .strip {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.8rem;
    margin-top: 1rem;
  }
  .page {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface);
    cursor: grab;
  }
  .page img {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    object-fit: cover;
    background: var(--bg);
  }
  .num {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 2;
    min-width: 1.4rem;
    text-align: center;
    padding: 1px 4px;
    border-radius: 6px;
    font-size: 0.78rem;
    font-weight: 700;
    background: var(--accent);
    color: var(--on-accent);
  }
  .tools {
    display: flex;
    justify-content: space-around;
    padding: 0.3rem;
    background: var(--surface);
  }
  .tools button {
    display: flex;
    padding: 5px;
    border: none;
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .tools button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tools .del {
    color: #d33;
  }
</style>
