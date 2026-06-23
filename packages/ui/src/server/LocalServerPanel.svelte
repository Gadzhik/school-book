<script lang="ts">
  /**
   * Управление встроенным библиотечным сервером (только десктоп).
   *
   * Команды Tauri (`server_status`/`start_server`/`stop_server`) есть лишь в
   * десктоп-оболочке — на вебе/мобильном `invoke` либо отсутствует, либо команда
   * не зарегистрирована, и панель прячется (probe в onMount).
   *
   * Роль (admin/power) проверяется на сервере для управляющих действий. Здесь,
   * до входа, кнопка нужна для первичного поднятия сервера на своей машине —
   * это локальное действие хоста; дальше доступом рулит сервер по ролям.
   */
  import { onMount } from 'svelte';
  import { connect } from './store';

  interface ServerInfo {
    running: boolean;
    address: string;
    port: number;
  }

  type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoke: Invoke | undefined =
    typeof window !== 'undefined' ? (window as any).__TAURI__?.core?.invoke : undefined;

  let supported = $state(false);
  let info = $state<ServerInfo | null>(null);
  let busy = $state(false);
  let error = $state('');

  onMount(async () => {
    if (!invoke) return;
    try {
      info = await invoke<ServerInfo>('server_status');
      supported = true; // команда есть → это десктоп
    } catch {
      supported = false; // веб/мобильный — панель не показываем
    }
  });

  async function start() {
    if (!invoke || busy) return;
    busy = true;
    error = '';
    try {
      info = await invoke<ServerInfo>('start_server');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function stop() {
    if (!invoke || busy) return;
    busy = true;
    error = '';
    try {
      await invoke('stop_server');
      info = { running: false, address: '', port: 0 };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  // Подключиться к только что поднятому локальному серверу.
  async function connectLocal() {
    if (info?.running) await connect(`localhost:${info.port}`);
  }
</script>

{#if supported}
  <div class="local-server">
    <div class="ls-head">
      <span class="ls-title">Локальный сервер</span>
      <span class="ls-state" class:on={info?.running}>
        {info?.running ? 'запущен' : 'остановлен'}
      </span>
    </div>

    {#if info?.running}
      <p class="ls-addr">
        Адрес: <strong>{info.address}:{info.port}</strong>
      </p>
      <div class="ls-row">
        <button class="primary sm" onclick={connectLocal}>Подключиться к нему</button>
        <button class="ghost sm" onclick={stop} disabled={busy}>Остановить</button>
      </div>
    {:else}
      <p class="ls-hint">Запустите сервер на этом компьютере, чтобы раздать книги в сети.</p>
      <button class="primary sm" onclick={start} disabled={busy}>
        {busy ? 'Запуск…' : 'Запустить сервер'}
      </button>
    {/if}

    {#if error}<p class="ls-error">{error}</p>{/if}
  </div>
{/if}

<style>
  .local-server {
    margin-top: 1rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .ls-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }
  .ls-title {
    font-weight: 700;
    color: var(--text);
  }
  .ls-state {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .ls-state.on {
    color: #2e7d32;
    font-weight: 600;
  }
  .ls-hint,
  .ls-addr {
    margin: 0 0 0.6rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .ls-addr strong {
    color: var(--text);
  }
  .ls-row {
    display: flex;
    gap: 0.6rem;
  }
  .primary {
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.55rem 1rem;
    font-weight: 700;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    padding: 0.55rem 1rem;
    cursor: pointer;
  }
  .sm {
    font-size: 0.9rem;
  }
  .ls-error {
    color: #c0392b;
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
  }
</style>
