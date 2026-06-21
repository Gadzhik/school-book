<script lang="ts">
  import { hyphenateSyllables, lookupWord } from '@reader/core';
  import type { ScreenRect } from '@reader/reader-engine';
  import Icon from './Icon.svelte';

  interface Props {
    word: string;
    rect: ScreenRect;
    onclose: () => void;
    /** Сохранить слово в «Мои слова» (определение передаётся при наличии). */
    onsave?: (word: string, definition?: string) => void;
  }
  const { word, rect, onclose, onsave }: Props = $props();

  const syllables = $derived(hyphenateSyllables(word));
  const entry = $derived(lookupWord(word));

  let saved = $state(false);
  function save() {
    onsave?.(word, entry?.definitions?.[0]);
    saved = true;
  }

  // Позиция карточки: под словом, с прижатием к краям экрана.
  const POP_W = 280;
  const left = $derived(
    Math.max(8, Math.min(rect.left, window.innerWidth - POP_W - 8)),
  );
  const top = $derived(rect.bottom + 8);

  function speak() {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'ru-RU';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="pop" style:left={`${left}px`} style:top={`${top}px`} style:width={`${POP_W}px`} role="dialog" aria-label={`Слово ${word}`}>
  <header>
    <span class="word">{word}</span>
    <div class="tools">
      <button class="icon-btn" onclick={speak} aria-label="Произнести слово"><Icon name="speaker" size={18} /></button>
      <button class="icon-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" size={18} /></button>
    </div>
  </header>

  <p class="syll">Слоги: <b>{syllables}</b></p>

  {#if entry}
    {#if entry.partOfSpeech}<p class="pos">{entry.partOfSpeech}</p>{/if}
    <ul class="defs">
      {#each entry.definitions as d}<li>{d}</li>{/each}
    </ul>
  {:else}
    <p class="empty">В локальном словаре нет этого слова. Полный офлайн-словарь подключим позже.</p>
  {/if}

  {#if onsave}
    <button class="save" onclick={save} disabled={saved}>
      {saved ? '✓ В «Мои слова»' : 'Сохранить в «Мои слова»'}
    </button>
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
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .word {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
  }
  .tools {
    display: flex;
    gap: 0.2rem;
  }
  .syll {
    margin: 0 0 0.5rem;
    color: var(--text);
    font-size: 0.95rem;
  }
  .pos {
    margin: 0 0 0.3rem;
    color: var(--muted);
    font-style: italic;
    font-size: 0.85rem;
  }
  .defs {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text);
    font-size: 0.92rem;
  }
  .defs li {
    margin-bottom: 0.25rem;
  }
  .empty {
    margin: 0;
    color: var(--muted);
    font-size: 0.88rem;
  }
  .save {
    margin-top: 0.7rem;
    width: 100%;
    padding: 0.55rem;
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .save:disabled {
    background: #2e9e5b;
    cursor: default;
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
