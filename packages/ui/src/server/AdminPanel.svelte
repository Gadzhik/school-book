<script lang="ts">
  /** Администрирование (ТЗ Часть 6, E8+E9): журнал действий + резервная копия. */
  import { onMount } from 'svelte';
  import { session } from './auth';
  import {
    auditEntries,
    adminBusy,
    adminError,
    canBackup,
    loadAudit,
    downloadBackup,
  } from './admin';

  const ACTION_LABEL: Record<string, string> = {
    register: 'регистрация',
    approve: 'одобрение',
    reject: 'блокировка',
    upload: 'добавлена книга',
    assign: 'назначено задание',
    unassign: 'удалено задание',
    backup: 'резервная копия',
  };

  onMount(loadAudit);

  function fmt(ts: number): string {
    return new Date(ts).toLocaleString('ru-RU');
  }
</script>

<section class="admin">
  <div class="bar">
    <h2>Журнал действий</h2>
    <button class="ghost sm" onclick={loadAudit} disabled={$adminBusy}>Обновить</button>
    {#if canBackup($session?.user.role)}
      <button class="primary sm" onclick={downloadBackup} disabled={$adminBusy}>
        Скачать резервную копию
      </button>
    {/if}
  </div>
  {#if $adminError}<p class="error">{$adminError}</p>{/if}

  {#if $auditEntries.length === 0}
    <p class="muted">Записей пока нет.</p>
  {:else}
    <ul>
      {#each $auditEntries as e (e.ts + e.actor + e.action)}
        <li>
          <span class="ts">{fmt(e.ts)}</span>
          <span class="actor">{e.actor}</span>
          <span class="action">{ACTION_LABEL[e.action] ?? e.action}</span>
          {#if e.detail}<span class="detail">{e.detail}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .admin {
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
  ul {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  li {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  .ts {
    color: var(--muted);
    min-width: 11ch;
  }
  .actor {
    font-weight: 600;
    color: var(--text);
  }
  .action {
    color: var(--accent);
  }
  .detail {
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .primary {
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
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
  .primary:disabled,
  .ghost:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    color: #c0392b;
  }
</style>
