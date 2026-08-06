<script lang="ts">
  /**
   * Словари школы: предметы и категории (ТЗ 5.3, права 6.1 — admin/power).
   * Правки уходят на сервер и оттуда расходятся по всем устройствам.
   * Классы 1–11 не редактируются — по ним привязаны пользователи и права,
   * поэтому показываем их только справочно.
   */
  import { onMount } from 'svelte';
  import type { TaxonomyKind } from '@reader/network';
  import {
    serverTaxonomy,
    taxonomyBusy,
    taxonomyError,
    pullTaxonomy,
    saveTaxonomyEntry,
    deleteTaxonomyEntry,
  } from './taxonomy';
  import { t, tr } from '../i18n';

  // Черновики новых записей по каждому словарю.
  let draft = $state<Record<TaxonomyKind, string>>({ subject: '', category: '' });
  // id записи, которую сейчас переименовывают, и её новое название.
  let editing = $state<string | null>(null);
  let editName = $state('');

  onMount(() => {
    void pullTaxonomy();
  });

  const SECTIONS: { kind: TaxonomyKind; title: string }[] = [
    { kind: 'subject', title: 'Предметы' },
    { kind: 'category', title: 'Категории' },
  ];

  function entriesOf(kind: TaxonomyKind) {
    return kind === 'subject' ? $serverTaxonomy.subjects : $serverTaxonomy.categories;
  }

  async function add(kind: TaxonomyKind) {
    const name = draft[kind].trim();
    if (!name) return;
    if (await saveTaxonomyEntry(kind, name)) draft[kind] = '';
  }

  function startEdit(id: string, name: string) {
    editing = id;
    editName = name;
  }

  async function commitEdit(kind: TaxonomyKind) {
    if (!editing || !editName.trim()) return (editing = null);
    await saveTaxonomyEntry(kind, editName, editing);
    editing = null;
  }

  async function remove(kind: TaxonomyKind, id: string, name: string) {
    const ok = confirm(
      tr(
        'Удалить «{0}» из словаря? Книги с этим тегом останутся, но тег перестанет показываться в фильтрах и навигации.',
        name,
      ),
    );
    if (ok) await deleteTaxonomyEntry(kind, id);
  }
</script>

<section class="tax">
  <div class="bar">
    <h2>{$t('Словари школы')}</h2>
    <button class="ghost sm" onclick={() => pullTaxonomy()} disabled={$taxonomyBusy}>
      {$t('Обновить')}
    </button>
  </div>
  <p class="muted small">
    {$t('Единые для всех устройств: правка появится у всех учителей и учеников после подключения.')}
  </p>
  {#if $taxonomyError}<p class="error">{$t($taxonomyError)}</p>{/if}

  {#each SECTIONS as sec (sec.kind)}
    <h3>{$t(sec.title)}</h3>
    <ul>
      {#each entriesOf(sec.kind) as e (e.id)}
        <li>
          {#if editing === e.id}
            <input
              class="edit"
              bind:value={editName}
              onkeydown={(ev) => ev.key === 'Enter' && commitEdit(sec.kind)}
            />
            <button class="ghost sm" onclick={() => commitEdit(sec.kind)} disabled={$taxonomyBusy}>
              {$t('Сохранить')}
            </button>
            <button class="ghost sm" onclick={() => (editing = null)}>{$t('Отмена')}</button>
          {:else}
            <span class="name">{e.name}</span>
            <span class="id">{e.id}</span>
            <button class="ghost sm" onclick={() => startEdit(e.id, e.name)}>
              {$t('Переименовать')}
            </button>
            <button
              class="danger sm"
              onclick={() => remove(sec.kind, e.id, e.name)}
              disabled={$taxonomyBusy}
            >
              {$t('Удалить')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="add">
      <input
        bind:value={draft[sec.kind]}
        placeholder={$t('Новое название')}
        onkeydown={(ev) => ev.key === 'Enter' && add(sec.kind)}
      />
      <button class="primary sm" onclick={() => add(sec.kind)} disabled={$taxonomyBusy}>
        {$t('Добавить')}
      </button>
    </div>
  {/each}

  <p class="muted small">
    {$t('Классы 1–11 не редактируются: по ним привязаны учётные записи и права доступа.')}
  </p>
</section>

<style>
  .tax {
    margin-top: 1.2rem;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text);
    flex: 1;
  }
  h3 {
    margin: 0.9rem 0 0.3rem;
    font-size: 0.95rem;
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.35rem 0.4rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .name {
    color: var(--text);
    font-weight: 600;
    flex: 1;
    min-width: 8rem;
  }
  .id {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .add {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .add input,
  .edit {
    flex: 1;
    min-width: 8rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .primary {
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .danger {
    border: 1px solid #c0392b;
    border-radius: 8px;
    background: transparent;
    color: #c0392b;
    cursor: pointer;
  }
  .sm {
    padding: 0.28rem 0.6rem;
    font-size: 0.82rem;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.8rem;
  }
  .error {
    color: #c0392b;
  }
</style>
