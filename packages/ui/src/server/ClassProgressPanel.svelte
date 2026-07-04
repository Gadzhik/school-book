<script lang="ts">
  /**
   * Панель класса (учитель/админ/power): сводный прогресс чтения всех
   * учеников по всем книгам + экспорт CSV. Данные — /api/class/{id}/progress.
   */
  import { onMount } from 'svelte';
  import { listClasses, type ClassEntry } from '@reader/core';
  import type { ClassProgressRow } from '@reader/network';
  import { session, authedClient } from './auth';
  import { t, tr, locale } from '../i18n';

  let classes = $state<ClassEntry[]>([]);
  let classId = $state('');
  let rows = $state<ClassProgressRow[]>([]);
  let busy = $state(false);
  let error = $state('');

  // Учителю — только его классы; админ/power — все.
  const myClasses = $derived(
    $session?.user.role === 'teacher'
      ? classes.filter((c) => ($session?.user.classes ?? []).includes(c.id))
      : classes,
  );

  onMount(async () => {
    classes = await listClasses();
    const first = ($session?.user.classes ?? [])[0] ?? classes[0]?.id ?? '';
    if (first) {
      classId = first;
      await load();
    }
  });

  async function load() {
    const c = authedClient();
    if (!c || !classId || busy) return;
    busy = true;
    error = '';
    try {
      rows = await c.classProgress(classId);
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось загрузить прогресс класса');
      rows = [];
    } finally {
      busy = false;
    }
  }

  // Группировка по ученику для отображения.
  const byStudent = $derived.by(() => {
    const m = new Map<string, { name: string; items: ClassProgressRow[] }>();
    for (const r of rows) {
      const g = m.get(r.userId) ?? { name: r.fullName, items: [] };
      g.items.push(r);
      m.set(r.userId, g);
    }
    for (const g of m.values()) g.items.sort((a, b) => b.updatedAt - a.updatedAt);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString($locale === 'en' ? 'en-GB' : 'ru-RU');
  }

  /** Выгрузить текущую таблицу в CSV (Excel-совместимо, ; как разделитель). */
  function exportCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const head = [tr('Ученик'), tr('Книга'), tr('Прогресс, %'), tr('Обновлено')];
    const lines = [head.join(';')];
    for (const r of rows) {
      lines.push(
        [
          esc(r.fullName),
          esc(r.bookTitle),
          String(Math.round(r.fraction * 100)),
          fmtDate(r.updatedAt),
        ].join(';'),
      );
    }
    // BOM — чтобы Excel открыл UTF-8 с кириллицей без кракозябр.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const cls = classes.find((c) => c.id === classId)?.label ?? classId;
    a.download = `progress_${cls}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<section class="cp">
  <div class="bar">
    <h2>{$t('Прогресс класса')}</h2>
    <select bind:value={classId} onchange={load} disabled={busy}>
      {#each myClasses as c (c.id)}
        <option value={c.id}>{$t(c.label)}</option>
      {/each}
    </select>
    <button class="ghost sm" onclick={load} disabled={busy}>{$t('Обновить')}</button>
    <button class="ghost sm" onclick={exportCsv} disabled={rows.length === 0}>
      {$t('Экспорт в CSV')}
    </button>
  </div>
  {#if error}<p class="error">{$t(error)}</p>{/if}

  {#if busy}
    <p class="muted">{$t('Загрузка…')}</p>
  {:else if byStudent.length === 0}
    <p class="muted">{$t('Пока нет данных: ученики ещё не читали книги с сервера.')}</p>
  {:else}
    {#each byStudent as g (g.name)}
      <div class="student">
        <h3>{g.name}</h3>
        <ul>
          {#each g.items as r (r.bookId)}
            <li>
              <span class="b-title">{r.bookTitle}</span>
              <span class="pbar"><span class="fill" style:width={`${Math.round(r.fraction * 100)}%`}></span></span>
              <span class="pct">{Math.round(r.fraction * 100)}%</span>
              <span class="date">{fmtDate(r.updatedAt)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
</section>

<style>
  .cp {
    margin-top: 1rem;
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
  select {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .ghost:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .student {
    margin-top: 0.8rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .student h3 {
    margin: 0 0 0.4rem;
    font-size: 0.95rem;
    color: var(--text);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .b-title {
    flex: 1 1 180px;
    color: var(--text);
    font-size: 0.9rem;
  }
  .pbar {
    flex: 0 0 120px;
    height: 8px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .pct {
    width: 3.2ch;
    text-align: right;
    font-size: 0.85rem;
    color: var(--text);
  }
  .date {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: #c0392b;
  }
</style>
