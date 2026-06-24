<script lang="ts">
  /**
   * Стартовый экран (ТЗ Часть 6): один объединённый экран — подключение к
   * серверу школы и вход/регистрация (см. AuthScreen, где это совмещено).
   * Здесь — обёртка с заголовком и состояниями «ожидает одобрения»/«заблокирован».
   */
  import { onMount } from 'svelte';
  import { serverStatus, connection, connect, restoreSession } from './store';
  import { session, logout, refreshMe } from './auth';
  import AuthScreen from './AuthScreen.svelte';
  // Запуск встроенного сервера (только десктоп; на вебе/мобильном прячется сам).
  import LocalServerPanel from './LocalServerPanel.svelte';

  onMount(() => {
    if ($connection) void restoreSession();
    if ($session) void refreshMe();
    void autoConnectSameOrigin();
  });

  // Origin WebView нативной оболочки Tauri (Android — tauri.localhost, iOS —
  // tauri://). Это НЕ реальный сервер, к нему подключаться нельзя.
  function isTauriOrigin(): boolean {
    if (typeof window === 'undefined') return false;
    const { protocol, host } = window.location;
    return protocol === 'tauri:' || host === 'tauri.localhost' || host.endsWith('.tauri.localhost');
  }

  // Если читалку отдал сам сервер (открыли http://<сервер>/ в браузере) и
  // подключения ещё нет — автоматически подключаемся к этому же origin.
  async function autoConnectSameOrigin() {
    if ($connection || $serverStatus) return;
    if (typeof window === 'undefined' || isTauriOrigin()) return;
    const { protocol, host } = window.location;
    if ((protocol !== 'http:' && protocol !== 'https:') || !host) return;
    await connect(host);
  }
</script>

<div class="welcome">
  <div class="card">
    <h1>Читалка для школьников</h1>

    {#if !$session}
      <AuthScreen />
      <!-- Поднять сервер на этой машине (десктоп). На вебе/мобильном не видно. -->
      <LocalServerPanel />
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
  .ghost {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    padding: 0.6rem 1rem;
    cursor: pointer;
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
