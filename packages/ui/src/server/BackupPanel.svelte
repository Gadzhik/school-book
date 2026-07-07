<script lang="ts">
  /**
   * Резервные копии (админ): настраиваемый автобэкап по расписанию,
   * ручная копия, скачивание БД/полного архива, восстановление из файла.
   */
  import { onMount } from 'svelte';
  import type { BackupSettings } from '@reader/network';
  import {
    backupInfo,
    backupFiles,
    backupBusy,
    backupError,
    backupNotice,
    loadBackupInfo,
    saveBackupSettings,
    backupNow,
    downloadBackup,
    downloadFullBackup,
    restoreFromFile,
  } from './admin';
  import { t, locale } from '../i18n';

  // Локальная редактируемая копия настроек (заполняется после загрузки).
  let form = $state<BackupSettings | null>(null);
  let restoreInput = $state<HTMLInputElement | null>(null);
  let confirmRestore = $state<File | null>(null);

  $effect(() => {
    if ($backupInfo && !form) form = { ...$backupInfo.settings };
  });

  onMount(loadBackupInfo);

  function fmtSize(n: number): string {
    if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} ${$t('ГБ')}`;
    if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} ${$t('МБ')}`;
    return `${Math.max(1, Math.round(n / 1024))} ${$t('КБ')}`;
  }
  function fmtTs(ts: number): string {
    return new Date(ts).toLocaleString($locale === 'en' ? 'en-GB' : 'ru-RU');
  }

  function onRestorePicked(e: Event): void {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) confirmRestore = f; // сначала явное подтверждение
  }
  async function doRestore(): Promise<void> {
    if (!confirmRestore) return;
    const f = confirmRestore;
    confirmRestore = null;
    if (restoreInput) restoreInput.value = '';
    await restoreFromFile(f);
  }
</script>

<section class="backup">
  <div class="bar">
    <h2>{$t('Резервные копии')}</h2>
    <button class="ghost sm" onclick={loadBackupInfo} disabled={$backupBusy}>
      {$t('Обновить')}
    </button>
  </div>

  {#if $backupError}<p class="error">{$t($backupError)}</p>{/if}
  {#if $backupNotice}<p class="notice">{$backupNotice}</p>{/if}

  {#if form && $backupInfo}
    <form
      class="settings"
      onsubmit={(e) => {
        e.preventDefault();
        if (form) saveBackupSettings(form);
      }}
    >
      <label class="row check">
        <input type="checkbox" bind:checked={form.enabled} />
        {$t('Автоматически делать резервные копии')}
      </label>

      <div class="grid" class:muted-block={!form.enabled}>
        <label class="row">
          <span>{$t('Расписание')}</span>
          <select bind:value={form.mode}>
            <option value="daily">{$t('ежедневно в заданное время')}</option>
            <option value="interval">{$t('каждые N часов')}</option>
          </select>
        </label>
        {#if form.mode === 'daily'}
          <label class="row">
            <span>{$t('Время (местное на сервере)')}</span>
            <input type="time" bind:value={form.dailyAt} required />
          </label>
        {:else}
          <label class="row">
            <span>{$t('Период, часов')}</span>
            <input type="number" min="1" max="720" bind:value={form.everyHours} required />
          </label>
        {/if}
        <label class="row">
          <span>{$t('Хранить копий')}</span>
          <input type="number" min="1" max="365" bind:value={form.keep} required />
        </label>
        <label class="row">
          <span>{$t('Папка на сервере (пусто — рядом с БД)')}</span>
          <input
            type="text"
            bind:value={form.dir}
            placeholder={$backupInfo.resolvedDir}
          />
        </label>
        <label class="row check">
          <input type="checkbox" bind:checked={form.includeBooks} />
          {$t('Включать книги (полный архив, медленнее и больше)')}
        </label>
      </div>

      <div class="actions">
        <button class="primary sm" type="submit" disabled={$backupBusy}>
          {$t('Сохранить настройки')}
        </button>
        <button class="ghost sm" type="button" onclick={backupNow} disabled={$backupBusy}>
          {$t('Сделать копию сейчас')}
        </button>
      </div>

      <p class="muted small">
        {$t('Папка копий')}: <code>{$backupInfo.resolvedDir}</code>
        {#if $backupInfo.lastBackupMs}
          · {$t('Последняя копия')}: {fmtTs($backupInfo.lastBackupMs)}
        {:else}
          · {$t('Копий ещё не было')}
        {/if}
      </p>
    </form>

    <div class="downloads">
      <h3>{$t('Скачать на этот компьютер')}</h3>
      <div class="actions">
        <button class="ghost sm" onclick={downloadBackup} disabled={$backupBusy}>
          {$t('Базу данных (.db)')}
        </button>
        <button class="ghost sm" onclick={downloadFullBackup} disabled={$backupBusy}>
          {$t('Полный архив с книгами (.zip)')}
        </button>
      </div>
    </div>

    <div class="restore">
      <h3>{$t('Восстановление')}</h3>
      <p class="muted small">
        {$t('Выберите файл копии (.db). Текущая база будет заменена; страховочная копия сохранится в папке копий. После восстановления перезапустите сервер.')}
      </p>
      {#if confirmRestore}
        <p class="warn">
          {$t('Заменить базу данных содержимым файла «{0}»? Действие необратимо (кроме страховочной копии).', confirmRestore.name)}
        </p>
        <div class="actions">
          <button class="danger sm" onclick={doRestore} disabled={$backupBusy}>
            {$t('Да, восстановить')}
          </button>
          <button
            class="ghost sm"
            onclick={() => {
              confirmRestore = null;
              if (restoreInput) restoreInput.value = '';
            }}
          >
            {$t('Отмена')}
          </button>
        </div>
      {:else}
        <input
          type="file"
          accept=".db"
          bind:this={restoreInput}
          onchange={onRestorePicked}
          disabled={$backupBusy}
        />
      {/if}
    </div>

    {#if $backupFiles.length > 0}
      <h3>{$t('Копии на сервере')}</h3>
      <ul class="files">
        {#each $backupFiles as f (f.name)}
          <li>
            <span class="name">{f.name}</span>
            <span class="size">{fmtSize(f.size)}</span>
            <span class="ts">{fmtTs(f.modifiedMs)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if $backupBusy}
    <p class="muted">{$t('Загрузка…')}</p>
  {/if}
</section>

<style>
  .backup {
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
    margin: 1rem 0 0.3rem;
    font-size: 0.98rem;
    color: var(--text);
  }
  .settings {
    margin-top: 0.6rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 0.5rem 1rem;
    margin: 0.5rem 0;
  }
  .muted-block {
    opacity: 0.55;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.85rem;
    color: var(--text);
  }
  .row.check {
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
  }
  .row span {
    color: var(--muted);
  }
  input[type='text'],
  input[type='number'],
  input[type='time'],
  select {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg, transparent);
    color: var(--text);
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.4rem;
  }
  .files {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
  }
  .files li {
    display: flex;
    gap: 0.8rem;
    flex-wrap: wrap;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  .files .name {
    font-weight: 600;
    color: var(--text);
    flex: 1;
    word-break: break-all;
  }
  .files .size,
  .files .ts {
    color: var(--muted);
    white-space: nowrap;
  }
  code {
    word-break: break-all;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.8rem;
  }
  .notice {
    color: var(--accent);
    font-size: 0.9rem;
  }
  .warn {
    color: #c0392b;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .error {
    color: #c0392b;
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
  .danger {
    border: none;
    border-radius: 8px;
    background: #c0392b;
    color: #fff;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled,
  .ghost:disabled,
  .danger:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
