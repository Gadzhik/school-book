<script lang="ts">
  /** Просмотр/редактирование выделения (ТЗ Часть 6, E3): заметка + удаление. */
  import type { Highlight } from '@reader/core';
  import Icon from './Icon.svelte';

  interface Props {
    highlight: Highlight;
    onsave: (note: string) => void;
    onremove: () => void;
    onclose: () => void;
  }
  const { highlight, onsave, onremove, onclose }: Props = $props();

  let note = $state('');
  // Заполняем из переданного выделения (компонент пересоздаётся на каждое).
  $effect(() => {
    note = highlight.note ?? '';
  });
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="pop" role="dialog" aria-label="Выделение">
  <header>
    <span class="frag" title={highlight.text}>
      «{highlight.text.length > 80 ? highlight.text.slice(0, 80) + '…' : highlight.text}»
    </span>
    <button class="icon-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" size={18} /></button>
  </header>

  <textarea
    bind:value={note}
    rows="3"
    placeholder="Заметка (необязательно)"
    aria-label="Заметка к выделению"
  ></textarea>

  <div class="actions">
    <button class="del" onclick={onremove}>
      <Icon name="trash" size={18} /> Удалить
    </button>
    <button class="save" onclick={() => onsave(note.trim())}>Сохранить</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
    background: transparent;
  }
  .pop {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 36;
    width: min(380px, 92vw);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
    padding: 0.8rem 0.9rem 0.9rem;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .frag {
    font-size: 0.92rem;
    color: var(--text);
    font-style: italic;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    resize: vertical;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: 0.7rem;
  }
  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.9rem;
    border-radius: 9px;
    font-weight: 600;
    cursor: pointer;
  }
  .del {
    border: 1px solid var(--border);
    background: transparent;
    color: #c0392b;
  }
  .save {
    border: none;
    background: var(--accent);
    color: var(--on-accent);
  }
  .icon-btn {
    display: flex;
    padding: 5px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--border);
  }
</style>
