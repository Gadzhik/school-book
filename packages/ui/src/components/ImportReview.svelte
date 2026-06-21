<script lang="ts">
  /**
   * Ревью авторазметки (ТЗ 5.4): после импорта показываем, какие теги
   * движок предложил и проставил. Пользователь подтверждает («Ок»),
   * правит («Изменить» → TagEditor) или убирает («Сбросить теги»).
   * Принцип ТЗ: предлагаем, а не навязываем — финальное слово за человеком.
   */
  import { importReview, dismissReview, clearReview, type ImportReviewItem } from '../stores';
  import { classes, subjects, categories, tagBook } from '../classification';
  import Icon from './Icon.svelte';

  interface Props {
    /** Открыть редактор тегов книги. */
    onedit: (bookId: string) => void;
  }
  const { onedit }: Props = $props();

  // Сопоставление id → подпись по каждому измерению.
  const classLabel = $derived(new Map($classes.map((c) => [c.id, String(c.number)])));
  const subjectLabel = $derived(new Map($subjects.map((s) => [s.id, s.name])));
  const categoryLabel = $derived(new Map($categories.map((c) => [c.id, c.name])));

  function chips(item: ImportReviewItem): string[] {
    return [
      ...item.classes.map((id) => `${classLabel.get(id) ?? id} кл.`),
      ...item.subjects.map((id) => subjectLabel.get(id) ?? id),
      ...item.categories.map((id) => categoryLabel.get(id) ?? id),
    ];
  }

  /** Сбросить авто-проставленные теги книги. */
  async function reset(item: ImportReviewItem) {
    await tagBook(item.bookId, { classes: [], subjects: [], categories: [] });
    dismissReview(item.bookId);
  }
</script>

{#if $importReview.length}
  <div class="review" role="region" aria-label="Авторазметка новых книг">
    <div class="head">
      <Icon name="book" size={18} />
      <strong>Предложены теги для новых книг</strong>
      <button class="link" onclick={clearReview}>Принять все</button>
    </div>
    <ul>
      {#each $importReview as item (item.bookId)}
        <li>
          <span class="title" title={item.title}>{item.title}</span>
          <span class="chips">
            {#each chips(item) as label}
              <span class="chip">{label}</span>
            {/each}
          </span>
          <span class="actions">
            <button class="link" onclick={() => onedit(item.bookId)}>Изменить</button>
            <button class="link" onclick={() => reset(item)}>Сбросить</button>
            <button class="link ok" onclick={() => dismissReview(item.bookId)}>Ок</button>
          </span>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .review {
    margin-bottom: 1.2rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 12px;
    background: var(--surface);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
    color: var(--text);
  }
  .head strong {
    flex: 1;
    font-size: 0.95rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .title {
    min-width: 8rem;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    flex: 1;
  }
  .chip {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 0.8rem;
    color: var(--text);
  }
  .actions {
    display: flex;
    gap: 0.6rem;
  }
  .link {
    border: none;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.2rem 0.1rem;
  }
  .link:hover {
    text-decoration: underline;
  }
  .link.ok {
    font-weight: 600;
  }
</style>
