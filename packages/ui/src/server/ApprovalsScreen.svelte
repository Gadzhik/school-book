<script lang="ts">
  /**
   * Экран одобрения регистраций (ТЗ Часть 6). Список заявок «ожидают»
   * сверху + уже активные ниже. Кнопки одобрить/заблокировать.
   */
  import { onMount } from 'svelte';
  import {
    manageableUsers,
    approvalsBusy,
    approvalsError,
    loadApprovals,
    approve,
    reject,
  } from './approvals';

  const ROLE_LABEL: Record<string, string> = {
    admin: 'Администратор',
    power: 'Старший пользователь',
    teacher: 'Учитель',
    student: 'Ученик',
  };

  onMount(loadApprovals);

  const pending = $derived($manageableUsers.filter((u) => u.status === 'pending'));
  const others = $derived($manageableUsers.filter((u) => u.status !== 'pending'));
</script>

<section class="appr">
  <div class="bar">
    <h2>Заявки и пользователи</h2>
    <button class="ghost sm" onclick={loadApprovals} disabled={$approvalsBusy}>Обновить</button>
  </div>
  {#if $approvalsError}<p class="error">{$approvalsError}</p>{/if}

  <h3>Ожидают одобрения ({pending.length})</h3>
  {#if pending.length === 0}
    <p class="muted">Новых заявок нет.</p>
  {:else}
    <ul>
      {#each pending as u (u.id)}
        <li>
          <span class="u-name">{u.fullName}</span>
          <span class="muted">{ROLE_LABEL[u.role] ?? u.role}</span>
          {#if u.classes.length}<span class="tag">кл. {u.classes.join(', ')}</span>{/if}
          {#if u.subjects.length}<span class="tag">{u.subjects.join(', ')}</span>{/if}
          <span class="spacer"></span>
          <button class="primary sm" onclick={() => approve(u.id)} disabled={$approvalsBusy}>
            Одобрить
          </button>
          <button class="ghost sm" onclick={() => reject(u.id)} disabled={$approvalsBusy}>
            Отклонить
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if others.length}
    <h3>Пользователи ({others.length})</h3>
    <ul>
      {#each others as u (u.id)}
        <li>
          <span class="u-name">{u.fullName}</span>
          <span class="muted">{ROLE_LABEL[u.role] ?? u.role}</span>
          {#if u.classes.length}<span class="tag">кл. {u.classes.join(', ')}</span>{/if}
          <span
            class="status"
            class:blocked={u.status === 'blocked'}
            class:active={u.status === 'active'}
          >
            {u.status === 'blocked' ? 'заблокирован' : 'активен'}
          </span>
          <span class="spacer"></span>
          {#if u.status === 'active'}
            <button class="ghost sm" onclick={() => reject(u.id)} disabled={$approvalsBusy}>
              Заблокировать
            </button>
          {:else}
            <button class="primary sm" onclick={() => approve(u.id)} disabled={$approvalsBusy}>
              Разблокировать
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .appr {
    margin-top: 1rem;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    font-size: 1.15rem;
    color: var(--text);
    margin: 0;
  }
  h3 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
    margin: 1rem 0 0.4rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .u-name {
    font-weight: 600;
    color: var(--text);
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .tag {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 0.78rem;
    color: var(--muted);
  }
  .status {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .status.active {
    color: #2e9e5b;
  }
  .status.blocked {
    color: #c0392b;
  }
  .spacer {
    flex: 1;
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
