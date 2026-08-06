<script lang="ts">
  import { get } from 'svelte/store';
  import { formatLabel, type BookMeta } from '@reader/core';
  import { view, removeBook } from '../stores';
  import { session, authedClient } from '../server/auth';
  import {
    canUpload,
    publishToServer,
    unpublishFromServer,
    tagsSignature,
    uploadError,
  } from '../server/upload';
  import { t, tr } from '../i18n';
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
    publishMsg = ok ? tr('✓ на сервере') : get(uploadError) || tr('ошибка');
    publishing = false;
    if (ok) setTimeout(() => (publishMsg = ''), 2500);
  }

  async function onUnpublish(e: MouseEvent) {
    e.stopPropagation();
    if (publishing) return;
    if (!confirm(tr('Снять «{0}» с публикации? Книга исчезнет с сервера, локальная копия останется.', book.title))) return;
    publishing = true;
    publishMsg = '';
    const ok = await unpublishFromServer(book);
    publishMsg = ok ? tr('снята с публикации') : get(uploadError) || tr('ошибка');
    publishing = false;
    setTimeout(() => (publishMsg = ''), 2500);
  }

  function open() {
    view.set({ name: 'reader', bookId: book.id });
  }

  async function onDelete(e: MouseEvent) {
    e.stopPropagation();
    if (confirm(tr('Удалить «{0}» из библиотеки?', book.title))) {
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
    <div class="actions">
      <button class="act" title={$t('Теги')} onclick={onTagClick} aria-label={$t('Теги книги')}>
        <Icon name="list" size={18} />
      </button>
      <button class="act" title={$t('Удалить')} onclick={onDelete} aria-label={$t('Удалить книгу')}>
        <Icon name="trash" size={18} />
      </button>
    </div>
  </div>
  <div class="meta">
    <p class="title" title={book.title}>{book.title}</p>
    {#if book.author}<p class="author">{book.author}</p>{/if}
    {#if percent > 0}
      <div class="progress" aria-label={$t('Прочитано {0}%', percent)}>
        <div class="bar" style:width={`${percent}%`}></div>
      </div>
    {/if}
    {#if canPublish}
      <button
        class="publish"
        class:synced
        onclick={onPublish}
        disabled={publishing}
        title={synced
          ? $t('Уже на сервере (нажмите, чтобы перезалить)')
          : $t('Опубликовать на сервере с текущими тегами')}
      >
        {publishing
          ? $t('Подождите…')
          : publishMsg ||
            (synced
              ? $t('✓ На сервере')
              : book.serverId
                ? $t('Обновить на сервере')
                : $t('Опубликовать на сервере'))}
      </button>
      {#if book.serverId && !publishing && !publishMsg}
        <button
          class="unpublish"
          onclick={onUnpublish}
          title={$t('Убрать книгу с сервера (локальная копия останется)')}
        >
          {$t('Снять с публикации')}
        </button>
      {/if}
    {/if}
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
  .unpublish {
    margin-top: 0.3rem;
    width: 100%;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font-size: 0.75rem;
    cursor: pointer;
  }
  .unpublish:hover {
    border-color: #c0392b;
    color: #c0392b;
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
  /*
   * Тач-устройства: hover'а нет, и кнопки «Теги»/«Удалить» были недостижимы —
   * тап по карточке открывал книгу. Показываем их всегда, но у НИЖНЕГО края
   * обложки, чтобы не спорить с меткой класса в правом верхнем углу, и с
   * пальцевым размером цели.
   */
  @media (hover: none) {
    .actions {
      opacity: 1;
      top: auto;
      bottom: 6px;
    }
    .act {
      padding: 9px;
    }
    /* Метка класса нужна всегда: прятать её под кнопки больше не надо —
       кнопки внизу. На таче :hover/:focus залипают после тапа. */
    .card:hover .tags,
    .card:focus-within .tags {
      opacity: 1;
    }
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
