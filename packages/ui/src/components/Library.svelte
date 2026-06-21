<script lang="ts">
  import { onMount } from 'svelte';
  import { getReadingStats, type ReadingStats } from '@reader/core';
  import { books, view, settings } from '../stores';
  import { startScanner } from '../scanner/store';
  import { loadTaxonomy, filteredBooks, filterActive } from '../classification';
  import { dueCount, refreshWords } from '../words/store';
  import { session, logout } from '../server/auth';

  // Управление книгами (добавить/сканировать) — не для ученика (ТЗ 6.1).
  const role = $derived($session?.user.role);
  const canManageBooks = $derived(role === 'teacher' || role === 'admin' || role === 'power');
  const ROLE_LABEL: Record<string, string> = {
    admin: 'Администратор',
    power: 'Старший пользователь',
    teacher: 'Учитель',
    student: 'Ученик',
  };
  import FileDropzone from './FileDropzone.svelte';
  import BookCard from './BookCard.svelte';
  import FacetFilter from './FacetFilter.svelte';
  import SmartShelves from './SmartShelves.svelte';
  import TagEditor from './TagEditor.svelte';
  import ImportReview from './ImportReview.svelte';
  import Icon from './Icon.svelte';

  // Книга, для которой открыт редактор тегов.
  let tagBookId = $state<string | null>(null);

  // Серия чтения (показывается, только если геймификация включена).
  let stats = $state<ReadingStats | null>(null);

  onMount(() => {
    void loadTaxonomy();
    void refreshWords();
    stats = getReadingStats();
  });
</script>

<div class="library">
  <header class="head">
    <div>
      <h1>Моя библиотека</h1>
      {#if $session}
        <p class="sub">{$session.user.fullName} · {ROLE_LABEL[role ?? ''] ?? role}</p>
      {:else}
        <p class="sub">Книги хранятся только на этом устройстве</p>
      {/if}
      {#if $settings.gamification && stats && stats.streak > 0}
        <p class="streak" title={`Дней с чтением всего: ${stats.totalDays}`}>
          🔥 Серия чтения: {stats.streak}
          {stats.streak === 1 ? 'день' : stats.streak < 5 ? 'дня' : 'дней'}
        </p>
      {/if}
    </div>
    <div class="head-actions">
      <button class="words-btn" onclick={() => view.set({ name: 'words' })}>
        <Icon name="book" size={18} />
        Мои слова
        {#if $dueCount > 0}<span class="badge">{$dueCount}</span>{/if}
      </button>
      <button class="words-btn" onclick={() => view.set({ name: 'report' })}>
        <Icon name="book" size={18} />
        Отчёт
      </button>
      <button class="words-btn" onclick={() => view.set({ name: 'server' })}>
        <Icon name="book" size={18} />
        Сервер
      </button>
      {#if canManageBooks}
        <button class="scan-btn" onclick={() => startScanner()}>
          <Icon name="plus" size={20} />
          Создать книгу из фото
        </button>
      {/if}
      {#if $session}
        <button class="words-btn" onclick={logout} title="Выйти из аккаунта">
          Выйти
        </button>
      {/if}
    </div>
  </header>

  <ImportReview onedit={(id) => (tagBookId = id)} />

  <SmartShelves />

  <div class="layout">
    <FacetFilter />

    <div class="content">
      <div class="grid">
        {#if canManageBooks}
          <FileDropzone />
        {/if}
        {#each $filteredBooks as book (book.id)}
          <BookCard {book} ontag={(id) => (tagBookId = id)} />
        {/each}
      </div>

      {#if $books.length === 0}
        {#if canManageBooks}
          <p class="empty">Пока пусто. Добавьте первую книгу — EPUB, FB2 или PDF.</p>
        {:else}
          <p class="empty">Книг пока нет. Скачайте книги класса на экране «Сервер».</p>
        {/if}
      {:else if $filteredBooks.length === 0 && $filterActive}
        <p class="empty">Под фильтр ничего не подходит. Измените условия.</p>
      {/if}
    </div>
  </div>
</div>

{#if tagBookId}
  <TagEditor bookId={tagBookId} onclose={() => (tagBookId = null)} />
{/if}

<style>
  .library {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.2rem;
  }
  .head h1 {
    margin: 0;
    font-size: 1.6rem;
    color: var(--text);
  }
  .sub {
    margin: 0.2rem 0 0;
    color: var(--muted);
  }
  .streak {
    margin: 0.4rem 0 0;
    font-weight: 600;
    color: var(--accent);
  }
  .scan-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1rem;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .scan-btn:hover {
    filter: brightness(1.05);
  }
  .head-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .words-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .words-btn .badge {
    min-width: 1.3rem;
    text-align: center;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.75rem;
  }
  .layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  @media (max-width: 720px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
  }
  .empty {
    margin-top: 2rem;
    text-align: center;
    color: var(--muted);
  }
</style>
