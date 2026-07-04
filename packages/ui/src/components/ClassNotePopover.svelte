<script lang="ts">
  /** Просмотр заметки учителя (видимой классу): автор, фрагмент, заметка.
      Убрать может автор или админ/power (canRemove решает родитель). */
  import type { ClassNote } from '@reader/network';
  import { t } from '../i18n';
  import Icon from './Icon.svelte';

  interface Props {
    note: ClassNote;
    canRemove: boolean;
    onremove: () => void;
    onclose: () => void;
  }
  const { note, canRemove, onremove, onclose }: Props = $props();
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="pop" role="dialog" aria-label={$t('Заметка учителя')}>
  <header>
    <span class="author">{note.authorName}</span>
    <button class="icon-btn" onclick={onclose} aria-label={$t('Закрыть')}>
      <Icon name="close" size={18} />
    </button>
  </header>
  <p class="frag" title={note.text}>
    «{note.text.length > 120 ? note.text.slice(0, 120) + '…' : note.text}»
  </p>
  {#if note.note}
    <p class="note">{note.note}</p>
  {:else}
    <p class="note muted">{$t('Учитель отметил этот фрагмент.')}</p>
  {/if}
  {#if canRemove}
    <div class="actions">
      <button class="del" onclick={onremove}>
        <Icon name="trash" size={18} /> {$t('Убрать у класса')}
      </button>
    </div>
  {/if}
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
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .author {
    font-weight: 700;
    color: var(--accent);
    font-size: 0.9rem;
  }
  .frag {
    margin: 0 0 0.5rem;
    font-size: 0.92rem;
    color: var(--text);
    font-style: italic;
  }
  .note {
    margin: 0;
    color: var(--text);
    line-height: 1.45;
  }
  .note.muted {
    color: var(--muted);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.7rem;
  }
  .del {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.9rem;
    border-radius: 9px;
    border: 1px solid var(--border);
    background: transparent;
    color: #c0392b;
    font-weight: 600;
    cursor: pointer;
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
