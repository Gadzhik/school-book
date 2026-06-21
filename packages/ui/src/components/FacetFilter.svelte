<script lang="ts">
  import type { Facet } from '@reader/core';
  import {
    classes,
    subjects,
    categories,
    facetFilter,
    filterActive,
    toggleFilter,
    setQuery,
    clearFilter,
  } from '../classification';

  function active(dim: Facet, id: string): boolean {
    return ($facetFilter[dim] ?? []).includes(id);
  }
</script>

<aside class="facets" aria-label="Фильтры">
  <div class="search">
    <input
      type="search"
      placeholder="Поиск по названию или автору"
      value={$facetFilter.query ?? ''}
      oninput={(e) => setQuery(e.currentTarget.value)}
    />
  </div>

  <section>
    <h3>Класс</h3>
    <div class="chips">
      {#each $classes as c}
        <button
          class="chip"
          class:active={active('classes', c.id)}
          onclick={() => toggleFilter('classes', c.id)}
        >
          {c.number}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Предмет</h3>
    <div class="chips">
      {#each $subjects as s}
        <button
          class="chip"
          class:active={active('subjects', s.id)}
          onclick={() => toggleFilter('subjects', s.id)}
        >
          {s.name}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Категория</h3>
    <div class="chips">
      {#each $categories as c}
        <button
          class="chip"
          class:active={active('categories', c.id)}
          onclick={() => toggleFilter('categories', c.id)}
        >
          {c.name}
        </button>
      {/each}
    </div>
  </section>

  {#if $filterActive}
    <button class="clear" onclick={clearFilter}>Сбросить фильтр</button>
  {/if}
</aside>

<style>
  .facets {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .search input {
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
  }
  section h3 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    padding: 0.35rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .chip.active {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .clear {
    align-self: flex-start;
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-size: 0.85rem;
  }
</style>
