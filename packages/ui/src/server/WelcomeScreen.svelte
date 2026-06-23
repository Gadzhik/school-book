<script lang="ts">
  /**
   * Стартовый экран (ТЗ Часть 6): для пользователя без аккаунта — только
   * подключение к серверу школы и вход/регистрация. Ничего лишнего.
   * Шаги: найти/ввести сервер → войти или зарегистрироваться → (ожидание).
   */
  import { onMount } from 'svelte';
  import {
    serverStatus,
    connecting,
    connectError,
    connection,
    connect,
    disconnect,
    restoreSession,
  } from './store';
  import { session, logout, refreshMe } from './auth';
  import AuthScreen from './AuthScreen.svelte';
  // Запуск встроенного сервера (только десктоп; на вебе/мобильном прячется сам).
  import LocalServerPanel from './LocalServerPanel.svelte';

  let address = $state('');
  let token = $state('');

  // Поиск серверов в LAN — только в нативной оболочке (Tauri).
  interface DiscoveredServer { baseUrl: string; name?: string; version?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tauriInvoke: undefined | (<T>(cmd: string) => Promise<T>) =
    typeof window !== 'undefined' ? (window as any).__TAURI__?.core?.invoke : undefined;
  let discovered = $state<DiscoveredServer[]>([]);
  let discovering = $state(false);

  onMount(() => {
    if ($connection) void restoreSession();
    if ($session) void refreshMe();
    void autoConnectSameOrigin();
  });

  // Если читалку отдал сам сервер (открыли http://<сервер>/ в браузере, без
  // Tauri-оболочки) и подключения ещё нет — автоматически подключаемся к этому
  // же origin. Тогда вход/админка доступны сразу, без ручного ввода адреса.
  async function autoConnectSameOrigin() {
    if ($connection || $serverStatus) return;
    if (tauriInvoke) return; // нативная оболочка — у неё свой выбор сервера
    if (typeof window === 'undefined') return;
    const { protocol, host } = window.location;
    if (protocol !== 'http:' && protocol !== 'https:') return;
    if (!host) return;
    await connect(host);
  }

  async function submit() {
    if (!address.trim()) return;
    await connect(address, token);
  }

  async function discover() {
    if (!tauriInvoke || discovering) return;
    discovering = true;
    connectError.set('');
    try {
      discovered = await tauriInvoke<DiscoveredServer[]>('discover_servers');
      if (discovered.length === 0) connectError.set('Серверы в сети не найдены.');
    } catch {
      connectError.set('Поиск не удался.');
    } finally {
      discovering = false;
    }
  }
</script>

<div class="welcome">
  <div class="card">
    <h1>Читалка для школьников</h1>

    {#if !$serverStatus}
      <p class="hint">
        Подключитесь к серверу вашей школы, чтобы войти или зарегистрироваться.
      </p>
      <div class="form">
        <input
          type="text"
          bind:value={address}
          placeholder="Адрес сервера, напр. 192.168.1.10:9700"
          onkeydown={(e) => e.key === 'Enter' && submit()}
        />
        <input type="text" bind:value={token} placeholder="Код доступа (если нужен)" />
        <button class="primary" onclick={submit} disabled={$connecting}>
          {$connecting ? 'Подключение…' : 'Подключиться'}
        </button>
        {#if tauriInvoke}
          <button class="ghost" onclick={discover} disabled={discovering}>
            {discovering ? 'Поиск…' : 'Найти сервер в сети'}
          </button>
        {/if}
        <button class="ghost" onclick={() => (address = '10.0.2.2:9700')}>
          Android-эмулятор
        </button>
      </div>

      {#if discovered.length}
        <ul class="discovered">
          {#each discovered as srv (srv.baseUrl)}
            <li>
              <span class="d-name">{srv.name ?? srv.baseUrl}</span>
              <button class="primary sm" onclick={() => connect(srv.baseUrl)}>Подключиться</button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if $connectError}<p class="error">{$connectError}</p>{/if}

      <!-- Поднять сервер на этой машине (десктоп). На вебе/мобильном не видно. -->
      <LocalServerPanel />
    {:else if !$session}
      <p class="server-line">
        Сервер: <strong>{$serverStatus.name ?? 'подключён'}</strong>
        <button class="link" onclick={disconnect}>сменить</button>
      </p>
      <AuthScreen />
    {:else if $session.user.status === 'pending'}
      <div class="pending">
        <p class="big">⏳ Заявка на рассмотрении</p>
        <p class="hint">
          {$session.user.fullName}, ваша регистрация ожидает одобрения учителем.
          После одобрения вы сможете войти и читать книги класса.
        </p>
        <div class="row">
          <button class="ghost" onclick={refreshMe}>Проверить статус</button>
          <button class="ghost" onclick={logout}>Выйти</button>
        </div>
      </div>
    {:else if $session.user.status === 'blocked'}
      <div class="pending">
        <p class="big">🚫 Доступ заблокирован</p>
        <p class="hint">Обратитесь к учителю или администратору.</p>
        <button class="ghost" onclick={logout}>Выйти</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .welcome {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--bg);
  }
  .card {
    width: 100%;
    max-width: 460px;
  }
  h1 {
    text-align: center;
    color: var(--text);
    font-size: 1.6rem;
    margin: 0 0 1rem;
  }
  .hint {
    color: var(--muted);
    line-height: 1.5;
    text-align: center;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 1rem 0;
  }
  .form input {
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    color: var(--text);
    font-size: 1rem;
  }
  .primary {
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.65rem 1rem;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary.sm {
    padding: 0.35rem 0.8rem;
    font-size: 0.85rem;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    padding: 0.6rem 1rem;
    cursor: pointer;
  }
  .discovered {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .discovered li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .d-name {
    font-weight: 600;
    color: var(--text);
  }
  .server-line {
    text-align: center;
    color: var(--muted);
    margin-bottom: 0.8rem;
  }
  .link {
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
  }
  .error {
    color: #c0392b;
    text-align: center;
  }
  .pending {
    text-align: center;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .pending .big {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 0.5rem;
  }
  .pending .row {
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    margin-top: 1rem;
  }
</style>
