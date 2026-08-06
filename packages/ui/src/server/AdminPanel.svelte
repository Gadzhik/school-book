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
    logLevelInfo,
    logLevelBusy,
    logLevelError,
    loadLogLevel,
    changeLogLevel,
  } from './admin';
  import type { LogLevel } from '@reader/network';
  import UsersPanel from './UsersPanel.svelte';
  import BackupPanel from './BackupPanel.svelte';
  import TaxonomyPanel from './TaxonomyPanel.svelte';
  import { canEditTaxonomy } from './taxonomy';
  import { t, locale } from '../i18n';

  const ACTION_LABEL: Record<string, string> = {
    register: 'регистрация',
    approve: 'одобрение',
    reject: 'блокировка',
    upload: 'добавлена книга',
    assign: 'назначено задание',
    unassign: 'удалено задание',
    backup: 'резервная копия',
    backup_settings: 'настройки бэкапа',
    restore: 'восстановление БД',
    log_level: 'уровень логов',
    create_user: 'создан пользователь',
    set_role: 'смена роли',
    delete_user: 'удалён пользователь',
  };

  onMount(() => {
    loadAudit();
    if (canBackup($session?.user.role)) loadLogLevel();
  });

  function fmt(ts: number): string {
    return new Date(ts).toLocaleString($locale === 'en' ? 'en-GB' : 'ru-RU');
  }

  // Пояснения уровней для админа (лестница: каждый включает предыдущие).
  const LEVEL_HINT: Record<string, string> = {
    error: 'только сбои и ошибки',
    warn: '+ предупреждения (что-то пошло не так, но сервер работает)',
    info: '+ основные события: старт, бэкапы, найденные книги (рекомендуется)',
    debug: '+ каждый запрос, входы пользователей, ход задач',
    verbose: '+ максимальная детализация (для глубокой диагностики, много записей)',
  };
</script>

<!-- Управление пользователями (создать/роли/блок/удаление) — admin/power. -->
<UsersPanel />

<!-- Словари школы: предметы и категории (ТЗ 5.3) — admin/power. -->
{#if canEditTaxonomy($session?.user.role)}
  <TaxonomyPanel />
{/if}

<!-- Резервные копии: автобэкап, скачивание, восстановление — только админ. -->
{#if canBackup($session?.user.role)}
  <BackupPanel />

  <!-- Уровень логирования сервера: применяется сразу, хранится в БД. -->
  <section class="loglevel">
    <div class="bar">
      <h2>{$t('Логи сервера')}</h2>
    </div>
    {#if $logLevelError}<p class="error">{$t($logLevelError)}</p>{/if}
    {#if $logLevelInfo}
      <label class="lvl">
        <span>{$t('Уровень подробности')}</span>
        <select
          value={$logLevelInfo.level}
          disabled={$logLevelBusy}
          onchange={(e) => changeLogLevel((e.currentTarget as HTMLSelectElement).value as LogLevel)}
        >
          {#each $logLevelInfo.levels as l (l)}
            <option value={l}>{l}{l === 'info' ? ` — ${$t('по умолчанию')}` : ''}</option>
          {/each}
        </select>
      </label>
      <p class="muted small">
        {$t(LEVEL_HINT[$logLevelInfo.level] ?? '')}
        {#if $logLevelInfo.envOverride}
          · {$t('На сервере задан RUST_LOG — при перезапуске он главнее этой настройки.')}
        {/if}
      </p>
    {/if}
  </section>
{/if}

<section class="admin">
  <div class="bar">
    <h2>{$t('Журнал действий')}</h2>
    <button class="ghost sm" onclick={loadAudit} disabled={$adminBusy}>{$t('Обновить')}</button>
  </div>
  {#if $adminError}<p class="error">{$t($adminError)}</p>{/if}

  {#if $auditEntries.length === 0}
    <p class="muted">{$t('Записей пока нет.')}</p>
  {:else}
    <ul>
      {#each $auditEntries as e (e.ts + e.actor + e.action)}
        <li>
          <span class="ts">{fmt(e.ts)}</span>
          <span class="actor">{e.actor}</span>
          <span class="action">{$t(ACTION_LABEL[e.action] ?? e.action)}</span>
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
  .loglevel {
    margin-top: 1.2rem;
  }
  .lvl {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.9rem;
    color: var(--text);
    margin-top: 0.5rem;
  }
  .lvl span {
    color: var(--muted);
  }
  .lvl select {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
  }
  .small {
    font-size: 0.8rem;
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
  .error {
    color: #c0392b;
  }
</style>
