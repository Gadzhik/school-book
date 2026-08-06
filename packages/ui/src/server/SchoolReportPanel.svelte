<script lang="ts">
  /**
   * Сводка по школе (ТЗ 6.1, строка «Отчёты: вся школа») — агрегат по каждому
   * классу: сколько учеников, сколько из них читали, средняя доля прочитанного
   * и последняя активность. Поклассный разрез по ученикам — в ClassProgressPanel.
   */
  import { onMount } from 'svelte';
  import type { SchoolProgressRow } from '@reader/network';
  import { authedClient } from './auth';
  import { t, tr, locale } from '../i18n';

  let rows = $state<SchoolProgressRow[]>([]);
  let busy = $state(false);
  let error = $state('');

  async function load() {
    const c = authedClient();
    if (!c || busy) return;
    busy = true;
    error = '';
    try {
      rows = await c.schoolProgress();
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось загрузить сводку');
    } finally {
      busy = false;
    }
  }

  onMount(load);

  function fmtDate(ts: number): string {
    return ts ? new Date(ts).toLocaleDateString($locale === 'en' ? 'en-GB' : 'ru-RU') : '—';
  }

  // Итог по школе: считаем по ученикам, а не среднее из средних по классам.
  const totals = $derived.by(() => {
    const students = rows.reduce((n, r) => n + r.students, 0);
    const readers = rows.reduce((n, r) => n + r.readers, 0);
    const sum = rows.reduce((n, r) => n + r.avgFraction * r.readers, 0);
    return { students, readers, avg: readers ? sum / readers : 0 };
  });
</script>

<section class="school">
  <div class="bar">
    <h2>{$t('Сводка по школе')}</h2>
    <button class="ghost sm" onclick={load} disabled={busy}>{$t('Обновить')}</button>
  </div>
  {#if error}<p class="error">{$t(error)}</p>{/if}

  {#if busy && rows.length === 0}
    <p class="muted">{$t('Загрузка…')}</p>
  {:else if rows.length === 0}
    <p class="muted">{$t('Пока нет данных: ученики ещё не читали книги с сервера.')}</p>
  {:else}
    <ul>
      <li class="head">
        <span class="cls">{$t('Класс')}</span>
        <span class="num">{$t('Учеников')}</span>
        <span class="num">{$t('Читают')}</span>
        <span class="num">{$t('Средний прогресс')}</span>
        <span class="num">{$t('Последняя активность')}</span>
      </li>
      {#each rows as r (r.classId)}
        <li>
          <span class="cls">{$t('{0} класс', r.classId)}</span>
          <span class="num">{r.students}</span>
          <span class="num">{r.readers}</span>
          <span class="num">{Math.round(r.avgFraction * 100)}%</span>
          <span class="num muted">{fmtDate(r.lastActivity)}</span>
        </li>
      {/each}
      <li class="total">
        <span class="cls">{$t('Всего')}</span>
        <span class="num">{totals.students}</span>
        <span class="num">{totals.readers}</span>
        <span class="num">{Math.round(totals.avg * 100)}%</span>
        <span class="num"></span>
      </li>
    </ul>
    <p class="muted small">
      {$t('Средний прогресс считается по тем, кто хоть что-то читал.')}
    </p>
  {/if}
</section>

<style>
  .school {
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
  ul {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
  }
  li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.35rem 0.4rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.88rem;
    color: var(--text);
  }
  li.head {
    color: var(--muted);
    font-size: 0.78rem;
  }
  li.total {
    font-weight: 700;
    border-bottom: none;
  }
  .cls {
    flex: 1;
    min-width: 5rem;
  }
  .num {
    min-width: 4.5rem;
    text-align: right;
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
