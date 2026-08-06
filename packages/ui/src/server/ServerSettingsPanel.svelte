<script lang="ts">
  /**
   * Настройки сервера: порт и код доступа (ТЗ 6.1 — строка «Настройки сервера»,
   * только администратор). Раньше и то и другое задавалось лишь переменными
   * окружения, то есть требовало доступа к машине сервера.
   *
   * Код доступа применяется сразу; порт — со следующего запуска: переезд на
   * другой порт на живом сервере оборвал бы все соединения, включая это.
   */
  import { onMount } from 'svelte';
  import type { ServerSettings } from '@reader/network';
  import { authedClient } from './auth';
  import { t, tr } from '../i18n';

  let info = $state<ServerSettings | null>(null);
  let port = $state('');
  let token = $state('');
  let busy = $state(false);
  let error = $state('');
  let msg = $state('');

  async function load() {
    const c = authedClient();
    if (!c) return;
    error = '';
    try {
      info = await c.serverSettings();
      port = String(info.desiredPort ?? info.port);
      token = info.token ?? '';
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось загрузить настройки');
    }
  }

  onMount(load);

  async function save() {
    const c = authedClient();
    if (!c || busy) return;
    const p = parseInt(port, 10);
    if (!Number.isFinite(p) || p < 1024 || p > 65535) {
      error = tr('Порт должен быть числом от 1024 до 65535');
      return;
    }
    busy = true;
    error = '';
    msg = '';
    try {
      await c.saveServerSettings({ port: p, token });
      await load();
      msg =
        p === info?.port
          ? tr('Сохранено.')
          : tr('Сохранено. Новый порт заработает после перезапуска сервера.');
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось сохранить');
    } finally {
      busy = false;
    }
  }
</script>

<section class="srv">
  <div class="bar">
    <h2>{$t('Настройки сервера')}</h2>
    <button class="ghost sm" onclick={load} disabled={busy}>{$t('Обновить')}</button>
  </div>
  {#if error}<p class="error">{$t(error)}</p>{/if}
  {#if msg}<p class="ok">{msg}</p>{/if}

  {#if info}
    <label class="row">
      <span>{$t('Порт')}</span>
      <input type="number" bind:value={port} min="1024" max="65535" disabled={busy} />
      <span class="muted small">{$t('сейчас: {0}', info.port)}</span>
    </label>
    {#if info.envPort}
      <p class="muted small">
        {$t('Порт задан переменной окружения CHITALKA_PORT — при перезапуске она главнее.')}
      </p>
    {/if}

    <label class="row">
      <span>{$t('Код доступа')}</span>
      <input
        type="text"
        bind:value={token}
        placeholder={$t('пусто — вход без кода')}
        disabled={busy}
      />
    </label>
    {#if info.envToken}
      <p class="muted small">
        {$t('Код задан переменной окружения CHITALKA_TOKEN — при перезапуске она главнее.')}
      </p>
    {/if}
    <p class="muted small">
      {$t('Код доступа применяется сразу: устройства с прежним кодом придётся подключить заново.')}
    </p>

    <button class="primary sm" onclick={save} disabled={busy}>
      {busy ? $t('Подождите…') : $t('Сохранить')}
    </button>
  {/if}
</section>

<style>
  .srv {
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
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
    font-size: 0.9rem;
    color: var(--text);
  }
  .row > span:first-child {
    color: var(--muted);
    min-width: 7rem;
  }
  .row input {
    flex: 1;
    min-width: 8rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .primary {
    margin-top: 0.7rem;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.35rem 0.8rem;
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
  .ok {
    color: #2e9e5b;
    font-size: 0.85rem;
  }
</style>
