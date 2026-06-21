<script lang="ts">
  /**
   * Помощник чтения (ТЗ Часть 3): по выделенному фрагменту локальная LLM
   * (Ollama) объясняет простыми словами или даёт краткое содержание.
   * Приватно, офлайн. Если Ollama недоступен — сообщаем, читалка не ломается.
   */
  import { explainText, summarizeText } from '@reader/core';
  import type { ScreenRect } from '@reader/reader-engine';
  import Icon from './Icon.svelte';

  interface Props {
    text: string;
    rect: ScreenRect;
    onclose: () => void;
    /** Выделить фрагмент (создать highlight). */
    onhighlight?: () => void;
  }
  const { text, rect, onclose, onhighlight }: Props = $props();

  let busy = $state(false);
  let result = $state('');
  let error = $state('');

  async function run(kind: 'explain' | 'summary') {
    if (busy) return;
    busy = true;
    result = '';
    error = '';
    try {
      result = kind === 'explain' ? await explainText(text) : await summarizeText(text);
    } catch {
      error = 'Помощник недоступен. Запустите Ollama или LM Studio (настройки → ИИ-помощник).';
    } finally {
      busy = false;
    }
  }

  // Позиция: под выделением, прижата к краям экрана.
  const POP_W = 320;
  const left = $derived(Math.max(8, Math.min(rect.left, window.innerWidth - POP_W - 8)));
  const top = $derived(rect.bottom + 8);
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div
  class="pop"
  style:left={`${left}px`}
  style:top={`${top}px`}
  style:width={`${POP_W}px`}
  role="dialog"
  aria-label="Помощник чтения"
>
  <header>
    <span class="frag" title={text}>«{text.length > 60 ? text.slice(0, 60) + '…' : text}»</span>
    <button class="icon-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" size={18} /></button>
  </header>

  <div class="actions">
    <button onclick={() => run('explain')} disabled={busy}>Объяснить просто</button>
    <button onclick={() => run('summary')} disabled={busy}>Кратко</button>
    {#if onhighlight}
      <button class="hl" onclick={() => onhighlight?.()} disabled={busy}>Выделить</button>
    {/if}
  </div>

  {#if busy}
    <p class="status">Думаю…</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if result}
    <p class="result">{result}</p>
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
    z-index: 36;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
    padding: 0.7rem 0.85rem 0.9rem;
    max-height: 60vh;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .frag {
    font-size: 0.9rem;
    color: var(--muted);
    font-style: italic;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .actions button {
    flex: 1;
    padding: 0.5rem;
    border: 1px solid var(--accent);
    border-radius: 9px;
    background: transparent;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
  }
  .actions button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .actions button.hl {
    border-color: #d9a400;
    color: #b58600;
  }
  .status {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .status.error {
    color: #c0392b;
  }
  .result {
    margin: 0;
    color: var(--text);
    font-size: 0.95rem;
    line-height: 1.5;
    white-space: pre-wrap;
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
