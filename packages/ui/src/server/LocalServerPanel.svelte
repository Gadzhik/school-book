<script lang="ts">
  /**
   * Управление встроенным библиотечным сервером (только десктоп).
   *
   * Команды Tauri (`server_status`/`start_server`/`stop_server`) есть лишь в
   * десктоп-оболочке — на вебе/мобильном `invoke` либо отсутствует, либо команда
   * не зарегистрирована, и панель прячется (probe в onMount).
   *
   * Правила запуска (защита от «зоопарка» серверов в школе):
   * - перед запуском ищем серверы в сети (mDNS `discover_servers`);
   * - если сервер уже есть — показываем «в сети уже есть сервер: имя (адрес)»,
   *   и ДОПОЛНИТЕЛЬНЫЙ сервер может запустить только вошедший администратор;
   * - если сети пусто — запуск свободный (первичное поднятие сервера школы).
   * Дальше доступом к данным рулит сам сервер по ролям.
   */
  import { onMount } from 'svelte';
  import { connect } from './store';
  import { session } from './auth';
  import { t, tr } from '../i18n';

  interface ServerInfo {
    running: boolean;
    address: string;
    port: number;
  }

  interface DiscoveredServer {
    baseUrl: string;
    name?: string;
  }

  type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoke: Invoke | undefined =
    typeof window !== 'undefined' ? (window as any).__TAURI__?.core?.invoke : undefined;

  let supported = $state(false);
  let info = $state<ServerInfo | null>(null);
  let busy = $state(false);
  let error = $state('');
  /// Серверы, уже найденные в сети (кроме нашего локального).
  let existing = $state<DiscoveredServer[]>([]);
  // Доп. сервер при живом чужом — только администратор.
  const isAdmin = $derived($session?.user.role === 'admin');
  const canStart = $derived(existing.length === 0 || isAdmin);

  /// Человекочитаемо: «Имя (host:port)».
  function srvLabel(s: DiscoveredServer): string {
    const host = s.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return s.name ? `${s.name} (${host})` : host;
  }

  /// Поиск чужих серверов в сети; свой запущенный исключаем по порту.
  async function scanNetwork(): Promise<void> {
    if (!invoke) return;
    try {
      const found = await invoke<DiscoveredServer[]>('discover_servers');
      const ownPort = info?.running ? `:${info.port}` : null;
      existing = found.filter((s) => !(ownPort && s.baseUrl.includes(ownPort)));
    } catch {
      existing = []; // поиск недоступен — не блокируем первичный запуск
    }
  }

  onMount(async () => {
    if (!invoke) return;
    try {
      info = await invoke<ServerInfo>('server_status');
      supported = true; // команда есть → это десктоп
    } catch {
      supported = false; // веб/мобильный — панель не показываем
      return;
    }
    void scanNetwork();
  });

  async function start() {
    if (!invoke || busy) return;
    busy = true;
    error = '';
    try {
      // Свежая проверка сети прямо перед запуском (панель могла висеть давно).
      await scanNetwork();
      if (existing.length > 0 && !isAdmin) {
        error = tr(
          'В сети уже есть запущенный сервер: {0}. Дополнительный сервер может запустить только администратор — войдите администратором.',
          existing.map(srvLabel).join(', ')
        );
        return;
      }
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
      <span class="ls-title">{$t('Локальный сервер')}</span>
      <span class="ls-state" class:on={info?.running}>
        {info?.running ? $t('запущен') : $t('остановлен')}
      </span>
    </div>

    {#if info?.running}
      <p class="ls-addr">
        {$t('Адрес:')} <strong>{info.address}:{info.port}</strong>
      </p>
      <div class="ls-row">
        <button class="primary sm" onclick={connectLocal}>{$t('Подключиться к нему')}</button>
        <button class="ghost sm" onclick={stop} disabled={busy}>{$t('Остановить')}</button>
      </div>
    {:else}
      {#if existing.length > 0}
        <p class="ls-exists">
          {$t('В сети уже есть запущенный сервер:')}
          <strong>{existing.map(srvLabel).join(', ')}</strong>
        </p>
        {#if !isAdmin}
          <p class="ls-hint">{$t('Дополнительный сервер может запустить только администратор.')}</p>
        {/if}
      {:else}
        <p class="ls-hint">{$t('Запустите сервер на этом компьютере, чтобы раздать книги в сети.')}</p>
      {/if}
      {#if canStart}
        <button class="primary sm" onclick={start} disabled={busy}>
          {busy ? $t('Запуск…') : $t('Запустить сервер')}
        </button>
      {/if}
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
  .ls-exists {
    margin: 0 0 0.4rem;
    color: #b26a00;
    font-size: 0.9rem;
  }
  .ls-exists strong {
    color: var(--text);
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
