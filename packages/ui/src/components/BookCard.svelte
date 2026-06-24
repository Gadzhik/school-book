<script lang="ts">
  import { get } from 'svelte/store';
  import { formatLabel, type BookMeta } from '@reader/core';
  import { view, removeBook } from '../stores';
  import { session, authedClient } from '../server/auth';
  import { canUpload, publishToServer, tagsSignature, uploadError } from '../server/upload';
  import Icon from './Icon.svelte';

  interface Props {
    book: BookMeta;
    /** Открыть редактор тегов книги. */
    ontag?: (id: string) => void;
  }
  const { book, ontag }: Props = $props();

  const percent = $derived(Math.round((book.progress ?? 0) * 100));

  // Публикация на сервер доступна тем, кто управляет контентом и подключён.
  const role = $derived($session?.user.role);
  const canPublish = $derived(!!authedClient() && canUpload(role));
  let publishing = $state(false);
  let publishMsg = $state('');
  // Синхронизирована ли книга с сервером: есть serverId и теги не менялись после
  // последней публикации. Тогда кнопка показывает «✓ На сервере», а не «Обновить».
  const synced = $derived(!!book.serverId && book.serverSynced === tagsSignature(book));

  async function onPublish(e: MouseEvent) {
    e.stopPropagation();
    if (publishing) return;
    publishing = true;
    publishMsg = '';
    const ok = await publishToServer(book);
    publishMsg = ok ? '✓ на сервере' : get(uploadError) || 'ошибка';
    publishing = false;
    if (ok) setTimeout(() => (publishMsg = ''), 2500);
  }

  function open() {
    view.set({ name: 'reader', bookId: book.id });
  }

  async function onDelete(e: MouseEvent) {
    e.stopPropagation();
    if (confirm(`Удалить «${book.title}» из библиотеки?`)) {
      await removeBook(book.id);
    }
  }

  function onTagClick(e: MouseEvent) {
    e.stopPropagation();
    ontag?.(book.id);
  }
</script>

<div
  class="card"
  role="button"
  tabindex="0"
  onclick={open}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
>
  <div class="cover">
    {#if book.cover}
      <img src={book.cover} alt={book.title} />
    {:else}
      <Icon name="book" size={48} />
    {/if}
    <span class="badge">{formatLabel(book.format)}</span>
  </div>
  <div class="meta">
    <p class="title" title={book.title}>{book.title}</p>
    {#if book.author}<p class="author">{book.author}</p>{/if}
    {#if percent > 0}
      <div class="progress" aria-label={`Прочитано ${percent}%`}>
        <div class="bar" style:width={`${percent}%`}></div>
      </div>
    {/if}
    {#if canPublish}
      <button
        class="publish"
        class:synced
        onclick={onPublish}
        disabled={publishing}
        title={synced ? 'Уже на сервере (нажмите, чтобы перезалить)' : 'Опубликовать на сервере с текущими тегами'}
      >
        {publishing
          ? 'Публикация…'
          : publishMsg || (synced ? '✓ На сервере' : book.serverId ? 'Обновить на сервере' : 'На сервер')}
      </button>
    {/if}
  </div>
  <div class="actions">
    <button class="act" title="Теги" onclick={onTagClick} aria-label="Теги книги">
      <Icon name="list" size={18} />
    </button>
    <button class="act" title="Удалить" onclick={onDelete} aria-label="Удалить книгу">
      <Icon name="trash" size={18} />
    </button>
  </div>
  {#if (book.classes?.length || book.subjects?.length || book.categories?.length)}
    <div class="tags">
      {#each book.classes ?? [] as c}<span class="tag cls">{c}</span>{/each}
    </div>
  {/if}
</div>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.12s, box-shadow 0.12s;
  }
  .card:hover,
  .card:focus-visible {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    outline: none;
  }
  .cover {
    position: relative;
    aspect-ratio: 3 / 4;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--muted);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .badge {
    position: absolute;
    top: 6px;
    left: 6px;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--on-accent);
  }
  .meta {
    padding: 0.5rem 0.6rem 0.7rem;
  }
  .title {
    margin: 0;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .author {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .publish {
    margin-top: 0.5rem;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--accent);
    border-radius: 8px;
    background: transparent;
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .publish:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .publish.synced {
    border-color: #2e9e5b;
    color: #2e9e5b;
  }
  .progress {
    margin-top: 0.5rem;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
  }
  .actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .act {
    display: flex;
    padding: 4px;
    border: none;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    cursor: pointer;
  }
  .card:hover .actions,
  .card:focus-within .actions {
    opacity: 1;
  }
  .tags {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 3px;
    pointer-events: none;
  }
  .card:hover .tags,
  .card:focus-within .tags {
    opacity: 0;
  }
  .tag.cls {
    min-width: 1.3rem;
    text-align: center;
    padding: 1px 5px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.72rem;
    font-weight: 700;
  }
</style>
