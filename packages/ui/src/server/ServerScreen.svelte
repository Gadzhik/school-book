<script lang="ts">
  /**
   * Экран библиотечного сервера (Фаза 5, ТЗ 4.3): подключение по адресу или
   * QR, просмотр OPDS-каталога, скачивание книг в локальную библиотеку.
   */
  import { onMount, onDestroy } from 'svelte';
  import type { OpdsEntry } from '@reader/network';
  import { view, books } from '../stores';
  import {
    connection,
    serverStatus,
    connecting,
    connectError,
    catalog,
    downloading,
    connect,
    disconnect,
    openCatalog,
    catalogBack,
    canCatalogBack,
    searchCatalog,
    serverIdOf,
    restoreSession,
    downloadEntry,
    coverUrl,
  } from './store';
  import { syncWords } from './words-sync';
  import { syncMarks } from './marks-sync';
  import { syncAll, initAutoSync } from './autosync';
  import { session, logout, refreshMe } from './auth';
  import { canManage, loadApprovals, manageableUsers } from './approvals';
  import { canUpload } from './upload';
  import { canAudit } from './admin';
  import AuthScreen from './AuthScreen.svelte';
  import ApprovalsScreen from './ApprovalsScreen.svelte';
  import BookUpload from './BookUpload.svelte';
  import AssignmentsScreen from './AssignmentsScreen.svelte';
  import AdminPanel from './AdminPanel.svelte';
  import LocalServerPanel from './LocalServerPanel.svelte';
  import PasswordChange from './PasswordChange.svelte';
  import QrCode from '../components/QrCode.svelte';
  import Icon from '../components/Icon.svelte';

  let showShare = $state(false);
  let copied = $state(false);
  let searchQ = $state('');

  async function runSearch() {
    await searchCatalog(searchQ);
  }
  async function clearSearch() {
    searchQ = '';
    await openCatalog();
  }

  // serverId → локальный id уже скачанной книги (показываем «Открыть»).
  const downloadedMap = $derived(
    new Map($books.filter((b) => b.serverId).map((b) => [b.serverId as string, b.id])),
  );
  function openLocal(bookId: string) {
    view.set({ name: 'reader', bookId });
  }

  // Адрес для подключения других устройств (из /status сервера).
  const shareUrl = $derived.by(() => {
    const st = $serverStatus;
    const conn = $connection;
    if (!st?.address || !st?.port) return '';
    if (conn?.token) {
      return `chitalka://pair?addr=${st.address}&port=${st.port}&token=${encodeURIComponent(conn.token)}`;
    }
    return `http://${st.address}:${st.port}`;
  });

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* буфер недоступен */
    }
  }

  let showApprovals = $state(false);
  let showUpload = $state(false);
  let showAssignments = $state(false);
  let showAdmin = $state(false);

  const ROLE_LABEL: Record<string, string> = {
    admin: 'Администратор',
    power: 'Старший пользователь',
    teacher: 'Учитель',
    student: 'Ученик',
  };
  const STATUS_LABEL: Record<string, string> = {
    pending: 'ожидает одобрения',
    active: 'активен',
    blocked: 'заблокирован',
  };
  // Подпись роли; скрываем, если совпадает с ФИО (напр. встроенный
  // «Администратор» — чтобы не дублировать одно и то же слово).
  const userRoleLabel = $derived(
    $session ? (ROLE_LABEL[$session.user.role] ?? $session.user.role) : '',
  );

  let wordsMsg = $state('');
  let wordsSyncing = $state(false);

  async function doSyncWords() {
    if (wordsSyncing) return;
    wordsSyncing = true;
    wordsMsg = '';
    const r = await syncWords();
    wordsMsg = r.ok
      ? `Слова синхронизированы (↑${r.pushed} ↓${r.pulled}).`
      : 'Не удалось синхронизировать слова.';
    wordsSyncing = false;
  }

  let marksMsg = $state('');
  let marksSyncing = $state(false);

  async function doSyncMarks() {
    if (marksSyncing) return;
    marksSyncing = true;
    marksMsg = '';
    const r = await syncMarks();
    marksMsg = r.ok
      ? `Заметки синхронизированы (закладки ↑${r.bookmarks.pushed} ↓${r.bookmarks.pulled}, выделения ↑${r.highlights.pushed} ↓${r.highlights.pulled}).`
      : 'Не удалось синхронизировать заметки.';
    marksSyncing = false;
  }

  let address = $state('');
  let token = $state('');

  // Нативная оболочка (Tauri) умеет mDNS-поиск серверов; в вебе кнопки нет.
  // __TAURI__ инжектится оболочкой и может появиться позже импорта модуля —
  // читаем лениво (функцией), флаг показа кнопки ставим в onMount.
  interface DiscoveredServer { baseUrl: string; name?: string; version?: string }
  function tauriInvoke(): undefined | (<T>(cmd: string) => Promise<T>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof window !== 'undefined' ? (window as any).__TAURI__?.core?.invoke : undefined;
  }
  let hasTauri = $state(false);
  let discovered = $state<DiscoveredServer[]>([]);
  let discovering = $state(false);

  async function discover() {
    const invoke = tauriInvoke();
    if (!invoke || discovering) return;
    discovering = true;
    connectError.set('');
    try {
      discovered = await invoke<DiscoveredServer[]>('discover_servers');
      if (discovered.length === 0) connectError.set('Серверы в сети не найдены.');
    } catch {
      connectError.set('Поиск не удался.');
    } finally {
      discovering = false;
    }
  }

  // --- QR-сканер (по возможности; иначе только ручной ввод) ---
  const qrSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  let scanning = $state(false);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let stream: MediaStream | null = null;
  let rafId = 0;

  onMount(() => {
    hasTauri = !!tauriInvoke();
    initAutoSync(); // авто-синк при возврате сети
    if ($connection) void restoreSession();
    // Освежить профиль (статус «ожидает» мог смениться на «активен»).
    if ($session) void refreshMe();
    // Подтянуть заявки, чтобы показать бейдж с числом ожидающих одобрения.
    if ($session?.user.status === 'active' && canManage($session.user.role)) {
      void loadApprovals();
    }
  });
  onDestroy(stopScan);

  // Число заявок, ожидающих одобрения (для бейджа на кнопке «Заявки»).
  const pendingCount = $derived($manageableUsers.filter((u) => u.status === 'pending').length);

  // Авто-синхронизация при активной сессии (вход/подключение/смена статуса).
  let lastSynced = '';
  $effect(() => {
    const s = $session;
    if (s && s.user.status === 'active' && s.user.id !== lastSynced) {
      lastSynced = s.user.id;
      void syncAll();
    }
  });

  async function submit() {
    if (!address.trim()) return;
    await connect(address, token);
  }

  /** Записи каталога: навигация (подкаталог) или книга (скачивание). */
  function isBook(e: OpdsEntry): boolean {
    return Boolean(e.acquisitionHref);
  }
  function navHref(e: OpdsEntry): string | undefined {
    return e.links.find((l) => l.type?.includes('opds-catalog') || l.rel === 'subsection')?.href
      ?? e.links.find((l) => !l.rel.includes('image'))?.href;
  }

  async function startScan() {
    if (!qrSupported) return;
    try {
      scanning = true;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!scanning || !videoEl) return;
        try {
          const codes = await detector.detect(videoEl);
          if (codes?.length) {
            address = codes[0].rawValue as string;
            stopScan();
            await submit();
            return;
          }
        } catch {
          /* кадр пропускаем */
        }
        rafId = requestAnimationFrame(() => void tick());
      };
      rafId = requestAnimationFrame(() => void tick());
    } catch {
      connectError.set('Камера недоступна. Введите адрес вручную.');
      stopScan();
    }
  }

  function stopScan() {
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
</script>

<div class="screen">
  <header class="head">
    <button class="back" onclick={() => view.set({ name: 'library' })}>
      <Icon name="close" size={18} /> Библиотека
    </button>
    <h1>Сетевая библиотека</h1>
  </header>

  {#if !$serverStatus}
    <section class="connect">
      <p class="hint">
        Подключитесь к серверу читалки в локальной сети: введите адрес
        (например <code>192.168.1.10:9700</code>) или отсканируйте QR с сервера.
      </p>
      <div class="form">
        <input
          type="text"
          bind:value={address}
          placeholder="192.168.1.10:9700 или http://…"
          onkeydown={(e) => e.key === 'Enter' && submit()}
        />
        <input type="text" bind:value={token} placeholder="Токен (если задан)" />
        <button class="primary" onclick={submit} disabled={$connecting}>
          {$connecting ? 'Подключение…' : 'Подключиться'}
        </button>
        {#if qrSupported && !scanning}
          <button class="ghost" onclick={startScan}>Сканировать QR</button>
        {/if}
        {#if hasTauri}
          <button class="ghost" onclick={discover} disabled={discovering}>
            {discovering ? 'Поиск…' : 'Найти серверы (LAN)'}
          </button>
        {/if}
        <button
          class="ghost"
          title="Адрес хоста для приложения в Android-эмуляторе"
          onclick={() => (address = '10.0.2.2:9700')}
        >
          Android-эмулятор
        </button>
      </div>

      {#if discovered.length}
        <ul class="discovered">
          {#each discovered as srv (srv.baseUrl)}
            <li>
              <span class="d-name">{srv.name ?? srv.baseUrl}</span>
              <span class="muted">{srv.baseUrl}</span>
              <button class="primary sm" onclick={() => connect(srv.baseUrl)}>Подключиться</button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if scanning}
        <div class="scanner">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={videoEl} playsinline></video>
          <button class="ghost" onclick={stopScan}>Отмена</button>
        </div>
      {/if}

      {#if $connectError}<p class="error">{$connectError}</p>{/if}

      <!-- Поднять локальный сервер (десктоп). На вебе/мобильном скрыто. -->
      <LocalServerPanel />
    </section>
  {:else}
    <section class="connected">
      <div class="server-bar">
        <span class="dot"></span>
        <strong>{$serverStatus.name ?? 'Сервер'}</strong>
        <span class="muted">книг: {$serverStatus.books ?? '—'}</span>
        <button class="ghost" onclick={() => openCatalog()}>Обновить</button>
        {#if shareUrl}
          <button class="ghost" onclick={() => (showShare = !showShare)}>
            {showShare ? 'Скрыть адрес' : 'Поделиться доступом'}
          </button>
        {/if}
        {#if $session && $session.user.status === 'active'}
          <button class="ghost" onclick={doSyncWords} disabled={wordsSyncing}>
            {wordsSyncing ? 'Синхронизация…' : 'Синхронизировать слова'}
          </button>
          <button class="ghost" onclick={doSyncMarks} disabled={marksSyncing}>
            {marksSyncing ? 'Синхронизация…' : 'Синхронизировать заметки'}
          </button>
        {/if}
        <button class="ghost" onclick={disconnect}>Отключиться</button>
      </div>

      {#if $session}
        <div class="user-bar">
          <span class="u-name">{$session.user.fullName}</span>
          {#if userRoleLabel !== $session.user.fullName}
            <span class="u-role">{userRoleLabel}</span>
          {/if}
          <span
            class="u-status"
            class:pending={$session.user.status === 'pending'}
            class:active={$session.user.status === 'active'}
          >
            {STATUS_LABEL[$session.user.status] ?? $session.user.status}
          </span>
          <button class="ghost sm" onclick={refreshMe}>Обновить статус</button>
          {#if $session.user.status === 'active' && canManage($session.user.role)}
            <button
              class="ghost sm approvals-btn"
              class:has-pending={pendingCount > 0}
              onclick={() => (showApprovals = !showApprovals)}
            >
              {showApprovals ? 'Скрыть заявки' : 'Заявки'}
              {#if pendingCount > 0}<span class="appr-badge">{pendingCount}</span>{/if}
            </button>
          {/if}
          {#if $session.user.status === 'active' && canUpload($session.user.role)}
            <button class="ghost sm" onclick={() => (showUpload = !showUpload)}>
              {showUpload ? 'Скрыть загрузку' : 'Добавить книгу'}
            </button>
          {/if}
          {#if $session.user.status === 'active'}
            <button class="ghost sm" onclick={() => (showAssignments = !showAssignments)}>
              {showAssignments ? 'Скрыть задания' : 'Задания'}
            </button>
          {/if}
          {#if $session.user.status === 'active' && canAudit($session.user.role)}
            <button class="ghost sm" onclick={() => (showAdmin = !showAdmin)}>
              {showAdmin ? 'Скрыть журнал' : 'Журнал'}
            </button>
          {/if}
          <button class="ghost sm" onclick={logout}>Выйти</button>
        </div>
      {/if}

      {#if $session && $session.user.status === 'active'}
        <PasswordChange />
      {/if}

      {#if $session && $session.user.status === 'active' && canManage($session.user.role) && showApprovals}
        <ApprovalsScreen />
      {/if}
      {#if $session && $session.user.status === 'active' && canUpload($session.user.role) && showUpload}
        <BookUpload />
      {/if}
      {#if $session && $session.user.status === 'active' && showAssignments}
        <AssignmentsScreen />
      {/if}
      {#if $session && $session.user.status === 'active' && canAudit($session.user.role) && showAdmin}
        <AdminPanel />
      {/if}

      {#if showShare && shareUrl}
        <div class="share">
          <div class="share-info">
            <p class="muted">Адрес для подключения других устройств:</p>
            <code class="share-url">{shareUrl}</code>
            <button class="ghost sm" onclick={copyShare}>{copied ? 'Скопировано ✓' : 'Копировать'}</button>
            <p class="muted">Откройте «Сервер» на другом устройстве и отсканируйте QR или введите адрес.</p>
          </div>
          <QrCode value={shareUrl} size={160} />
        </div>
      {/if}

      {#if wordsMsg}<p class="muted">{wordsMsg}</p>{/if}
      {#if marksMsg}<p class="muted">{marksMsg}</p>{/if}
      {#if $connectError}<p class="error">{$connectError}</p>{/if}

      {#if !$session}
        <AuthScreen />
      {:else if $session.user.status === 'pending'}
        <p class="pending-note">
          Ваша заявка ожидает одобрения учителем. После одобрения станут доступны
          книги класса. Можно нажать «Обновить статус».
        </p>
      {/if}

      {#if $session && $session.user.status !== 'pending'}
        <div class="search-bar">
          <input
            type="search"
            bind:value={searchQ}
            placeholder="Поиск книги по названию или автору"
            onkeydown={(e) => e.key === 'Enter' && runSearch()}
          />
          <button class="primary sm" onclick={runSearch}>Найти</button>
          <button class="ghost sm" onclick={clearSearch}>Все книги</button>
          <button class="ghost sm" onclick={() => openCatalog('/opds')}>По разделам</button>
          {#if canUpload($session.user.role)}
            <button class="ghost sm" onclick={() => openCatalog('/opds/mine')}>Мои книги</button>
          {/if}
        </div>
      {/if}

      {#if $session && $session.user.status !== 'pending' && $catalog}
        <div class="feed-head">
          {#if $canCatalogBack}
            <button class="ghost sm" onclick={catalogBack}>
              <Icon name="close" size={16} /> Назад
            </button>
          {/if}
          <h2 class="feed-title">{$catalog.feed.title}</h2>
        </div>
        {#if $catalog.feed.entries.length === 0}
          <p class="muted">Каталог пуст.</p>
        {/if}
        <ul class="entries">
          {#each $catalog.feed.entries as entry (entry.id)}
            {@const cover = coverUrl(entry)}
            <li>
              {#if cover}
                <img
                  class="e-cover"
                  src={cover}
                  alt=""
                  loading="lazy"
                  onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                />
              {/if}
              <span class="e-title">{entry.title}</span>
              {#if entry.authors.length}
                <span class="muted">{entry.authors.join(', ')}</span>
              {/if}
              {#if isBook(entry)}
                {@const localId = downloadedMap.get(serverIdOf(entry))}
                {#if localId}
                  <button class="primary sm" onclick={() => openLocal(localId)}>Открыть</button>
                  <span class="downloaded">✓ скачано</span>
                {:else}
                  <button
                    class="primary sm"
                    disabled={$downloading.has(entry.id || entry.acquisitionHref || '')}
                    onclick={() => downloadEntry(entry)}
                  >
                    {$downloading.has(entry.id || entry.acquisitionHref || '')
                      ? 'Скачивание…'
                      : 'Скачать'}
                  </button>
                {/if}
              {:else}
                {@const href = navHref(entry)}
                {#if href}
                  <button class="ghost sm" onclick={() => openCatalog(href, true)}>Открыть</button>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else if $connecting}
        <p class="muted">Загрузка каталога…</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .screen {
    max-width: 820px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.2rem;
  }
  .head h1 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--text);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    padding: 0.4rem 0.7rem;
    cursor: pointer;
  }
  .hint {
    color: var(--muted);
    line-height: 1.5;
  }
  .hint code {
    background: var(--bg);
    padding: 0 0.3rem;
    border-radius: 4px;
  }
  .form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin: 1rem 0;
  }
  .form input {
    flex: 1 1 220px;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .primary {
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.55rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary.sm,
  .ghost.sm {
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    padding: 0.55rem 0.9rem;
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
    gap: 0.7rem;
    flex-wrap: wrap;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .d-name {
    flex: 1;
    font-weight: 600;
    color: var(--text);
  }
  .scanner {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
    margin-bottom: 1rem;
  }
  .scanner video {
    width: min(360px, 100%);
    border-radius: 12px;
    background: #000;
  }
  .error {
    color: #c0392b;
  }
  .server-bar {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    margin-bottom: 1rem;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #2ecc71;
  }
  .share {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    margin-bottom: 1rem;
  }
  .share-info {
    flex: 1;
    min-width: 220px;
  }
  .share-url {
    display: block;
    word-break: break-all;
    background: var(--bg);
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    margin: 0.3rem 0;
    font-size: 0.85rem;
    color: var(--text);
  }
  .user-bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    margin-bottom: 1rem;
  }
  .u-name {
    font-weight: 700;
    color: var(--text);
  }
  .u-role {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .u-status {
    padding: 0.1rem 0.55rem;
    border-radius: 999px;
    font-size: 0.78rem;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .u-status.pending {
    color: #b58600;
    border-color: #d9a400;
  }
  .u-status.active {
    color: #2e9e5b;
    border-color: #2e9e5b;
  }
  .pending-note {
    color: var(--muted);
    line-height: 1.5;
    padding: 0.8rem;
    border: 1px dashed var(--border);
    border-radius: 10px;
  }
  .muted {
    color: var(--muted);
    font-size: 0.88rem;
  }
  .feed-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0.5rem 0;
  }
  .feed-title {
    font-size: 1.1rem;
    color: var(--text);
    margin: 0;
  }
  .search-bar {
    display: flex;
    gap: 0.5rem;
    margin: 0.8rem 0 0.4rem;
    flex-wrap: wrap;
  }
  .search-bar input {
    flex: 1;
    min-width: 180px;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  .downloaded {
    color: #2e7d32;
    font-size: 0.8rem;
  }
  .approvals-btn {
    position: relative;
  }
  .approvals-btn.has-pending {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  .appr-badge {
    display: inline-block;
    min-width: 1.2rem;
    margin-left: 0.35rem;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.75rem;
    text-align: center;
  }
  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .entries li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .e-cover {
    width: 36px;
    height: 50px;
    object-fit: cover;
    border-radius: 4px;
    background: var(--bg);
    flex-shrink: 0;
  }
  .e-title {
    flex: 1;
    font-weight: 600;
    color: var(--text);
  }
</style>
