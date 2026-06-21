<script lang="ts">
  import { smartShelves, applyFilter } from '../classification';
</script>

{#if $smartShelves.length > 0}
  <section class="shelves" aria-label="Смарт-полки">
    <h2>Полки</h2>
    <div class="row">
      {#each $smartShelves as shelf}
        <button class="shelf" onclick={() => applyFilter(shelf.filter)}>
          <span class="label">{shelf.label}</span>
          <span class="count">{shelf.count}</span>
        </button>
      {/each}
    </div>
  </section>
{/if}

<style>
  .shelves {
    margin-bottom: 1.2rem;
  }
  .shelves h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 0.3rem;
  }
  .shelf {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    font-size: 0.9rem;
  }
  .shelf:hover {
    border-color: var(--accent);
  }
  .count {
    min-width: 1.5rem;
    text-align: center;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.75rem;
    font-weight: 700;
  }
</style>
