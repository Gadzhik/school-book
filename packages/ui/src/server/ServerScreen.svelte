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
    refreshStatus,
    downloadEntry,
    deleteServerBook,
    deletingServer,
    catalogStack,
    coverUrl,
  } from './store';
  import { syncWords } from './words-sync';
  import { syncMarks } from './marks-sync';
  import { syncAll, initAutoSync } from './autosync';
  import { session, logout, refreshMe } from './auth';
  import { canManage, loadApprovals, manageableUsers } from './approvals';
  import { canUpload } from './upload';
  import { canAudit } from './admin';
  import { pullTaxonomy } from './taxonomy';
  import AuthScreen from './AuthScreen.svelte';
  import ApprovalsScreen from './ApprovalsScreen.svelte';
  import BookUpload from './BookUpload.svelte';
  import AssignmentsScreen from './AssignmentsScreen.svelte';
  import ClassProgressPanel from './ClassProgressPanel.svelte';
  import QuizzesPanel from './QuizzesPanel.svelte';
  import AdminPanel from './AdminPanel.svelte';
  import LocalServerPanel from './LocalServerPanel.svelte';
  import UpdatePanel from './UpdatePanel.svelte';
  import PasswordChange from './PasswordChange.svelte';
  import QrCode from '../components/QrCode.svelte';
  import Icon from '../components/Icon.svelte';
  import { t, tr } from '../i18n';

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

  /**
   * Можно ли удалять книги из ОТКРЫТОГО сейчас раздела каталога (ТЗ 6.1).
   * Админ и power — по всей школе. Учитель — только свои книги, а гарантированно
   * свои они только в разделе «Мои книги»: в общем фиде владелец не виден, и
   * кнопка на чужой книге всё равно упёрлась бы в отказ сервера.
   */
  const canDeleteHere = $derived.by(() => {
    const role = $session?.user.role;
    if (role === 'admin' || role === 'power') return true;
    return role === 'teacher' && $catalogStack.at(-1) === '/opds/mine';
  });

  async function removeFromServer(entry: OpdsEntry) {
    const ok = confirm(
      tr(
        'Удалить «{0}» с сервера? Файл и запись каталога будут удалены, скачанные копии на устройствах останутся.',
        entry.title,
      ),
    );
    if (ok) await deleteServerBook(entry);
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
  let showClassProgress = $state(false);
  let showQuizzes = $state(false);
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
    $session ? $t(ROLE_LABEL[$session.user.role] ?? $session.user.role) : '',
  );

  let wordsMsg = $state('');
  let wordsSyncing = $state(false);

  async function doSyncWords() {
    if (wordsSyncing) return;
    wordsSyncing = true;
    wordsMsg = '';
    const r = await syncWords();
    wordsMsg = r.ok
      ? tr('Слова синхронизированы (↑{0} ↓{1}).', r.pushed, r.pulled)
      : tr('Не удалось синхронизировать слова.');
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
      ? tr(
          'Заметки синхронизированы (закладки ↑{0} ↓{1}, выделения ↑{2} ↓{3}).',
          r.bookmarks.pushed,
          r.bookmarks.pulled,
          r.highlights.pushed,
          r.highlights.pulled,
        )
      : tr('Не удалось синхронизировать заметки.');
    marksSyncing = false;
  }

  let address = $state('');

  // Кнопка-подстановка адреса для Android-эмулятора — только в dev-сборке.
  const devMode: boolean = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (import.meta as any).env?.DEV === true;
    } catch {
      return false;
    }
  })();

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
      if (discovered.length === 0) connectError.set(tr('Серверы в сети не найдены.'));
    } catch {
      connectError.set(tr('Поиск не удался.'));
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
    // Словари школы (предметы/категории) — с сервера, чтобы у всех был один
    // список. Молча: нет сервера — работаем на локальных.
    if ($connection) void pullTaxonomy(true);
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
    // Пэйринг-токен вручную не вводится: при QR-пэйринге он внутри QR.
    await connect(address);
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
      connectError.set(tr('Камера недоступна. Введите адрес вручную.'));
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
      <Icon name="close" size={18} /> {$t('Библиотека')}
    </button>
    <h1>{$t('Сетевая библиотека')}</h1>
  </header>

  {#if !$serverStatus}
    <section class="connect">
      <p class="hint">
        {$t('Подключитесь к серверу читалки в локальной сети: введите адрес (например')}
        <code>192.168.1.10:9700</code>{$t(') или отсканируйте QR с сервера.')}
      </p>
      <div class="form">
        <input
          type="text"
          bind:value={address}
          placeholder={$t('192.168.1.10:9700 или http://…')}
          onkeydown={(e) => e.key === 'Enter' && submit()}
        />
        <button class="primary" onclick={submit} disabled={$connecting}>
          {$connecting ? $t('Подключение…') : $t('Подключиться')}
        </button>
        {#if qrSupported && !scanning}
          <button class="ghost" onclick={startScan}>{$t('Сканировать QR')}</button>
        {/if}
        {#if hasTauri}
          <button class="ghost" onclick={discover} disabled={discovering}>
            {discovering ? $t('Поиск…') : $t('Найти серверы (LAN)')}
          </button>
        {/if}
        {#if devMode}
          <button
            class="ghost"
            title={$t('Адрес хоста для приложения в Android-эмуляторе')}
            onclick={() => (address = '10.0.2.2:9700')}
          >
            Android-эмулятор
          </button>
        {/if}
      </div>

      {#if discovered.length}
        <ul class="discovered">
          {#each discovered as srv (srv.baseUrl)}
            <li>
              <span class="d-name">{srv.name ?? srv.baseUrl}</span>
              <span class="muted">{srv.baseUrl}</span>
              <button class="primary sm" onclick={() => connect(srv.baseUrl)}
                >{$t('Подключиться')}</button
              >
            </li>
          {/each}
        </ul>
      {/if}

      {#if scanning}
        <div class="scanner">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={videoEl} playsinline></video>
          <button class="ghost" onclick={stopScan}>{$t('Отмена')}</button>
        </div>
      {/if}

      {#if $connectError}<p class="error">{$t($connectError)}</p>{/if}

      <!-- Поднять локальный сервер (десктоп). На вебе/мобильном скрыто. -->
      <LocalServerPanel />
    </section>
  {:else if $session?.user.mustChangePassword}
    <!-- Принудительная смена пароля: встроенный admin/admin или пароль,
         выданный админом. Работа с сервером закрыта, пока не сменит. -->
    <section class="connected">
      <div class="force-pw">
        <h2>{$t('Смените пароль')}</h2>
        <p>
          {$t('Ваш пароль задан по умолчанию или выдан администратором. Для безопасности задайте собственный пароль — без этого работа с сервером недоступна.')}
        </p>
        <PasswordChange />
        <button class="ghost sm" onclick={logout}>{$t('Выйти')}</button>
      </div>
    </section>
  {:else}
    <section class="connected">
      <div class="server-bar">
        <span class="dot"></span>
        <strong>{$serverStatus.name ?? $t('Сервер')}</strong>
        <span class="muted">{$t('книг: {0}', $serverStatus.books ?? '—')}</span>
        <button
          class="ghost"
          onclick={() => {
            void refreshStatus(); // счётчик «книг: N» тоже освежаем
            void openCatalog();
          }}>{$t('Обновить')}</button
        >
        {#if shareUrl}
          <button class="ghost" onclick={() => (showShare = !showShare)}>
            {showShare ? $t('Скрыть адрес') : $t('Поделиться доступом')}
          </button>
        {/if}
        {#if $session && $session.user.status === 'active'}
          <button class="ghost" onclick={doSyncWords} disabled={wordsSyncing}>
            {wordsSyncing ? $t('Синхронизация…') : $t('Синхронизировать слова')}
          </button>
          <button class="ghost" onclick={doSyncMarks} disabled={marksSyncing}>
            {marksSyncing ? $t('Синхронизация…') : $t('Синхронизировать заметки')}
          </button>
        {/if}
        <button class="ghost" onclick={disconnect}>{$t('Отключиться')}</button>
      </div>

      <!-- Вкладка «Доступно обновление»: видна, когда на сервере выложена
           версия новее установленной (для web/desktop/android). -->
      <UpdatePanel />

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
            {$t(STATUS_LABEL[$session.user.status] ?? $session.user.status)}
          </span>
          <button class="ghost sm" onclick={refreshMe}>{$t('Обновить статус')}</button>
          {#if $session.user.status === 'active' && canManage($session.user.role)}
            <button
              class="ghost sm approvals-btn"
              class:has-pending={pendingCount > 0}
              onclick={() => (showApprovals = !showApprovals)}
            >
              {showApprovals ? $t('Скрыть заявки') : $t('Заявки')}
              {#if pendingCount > 0}<span class="appr-badge">{pendingCount}</span>{/if}
            </button>
          {/if}
          {#if $session.user.status === 'active' && canUpload($session.user.role)}
            <button class="ghost sm" onclick={() => (showUpload = !showUpload)}>
              {showUpload ? $t('Скрыть загрузку') : $t('Добавить книгу')}
            </button>
          {/if}
          {#if $session.user.status === 'active'}
            <button class="ghost sm" onclick={() => (showAssignments = !showAssignments)}>
              {showAssignments ? $t('Скрыть задания') : $t('Задания')}
            </button>
            <button class="ghost sm" onclick={() => (showQuizzes = !showQuizzes)}>
              {showQuizzes ? $t('Скрыть квизы') : $t('Квизы')}
            </button>
          {/if}
          {#if $session.user.status === 'active' && canManage($session.user.role)}
            <button class="ghost sm" onclick={() => (showClassProgress = !showClassProgress)}>
              {showClassProgress ? $t('Скрыть класс') : $t('Мой класс')}
            </button>
          {/if}
          {#if $session.user.status === 'active' && canAudit($session.user.role)}
            <button class="ghost sm" onclick={() => (showAdmin = !showAdmin)}>
              {showAdmin ? $t('Скрыть журнал') : $t('Журнал')}
            </button>
          {/if}
          <button class="ghost sm" onclick={logout}>{$t('Выйти')}</button>
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
      {#if $session && $session.user.status === 'active' && showQuizzes}
        <QuizzesPanel />
      {/if}
      {#if $session && $session.user.status === 'active' && canManage($session.user.role) && showClassProgress}
        <ClassProgressPanel />
      {/if}
      {#if $session && $session.user.status === 'active' && canAudit($session.user.role) && showAdmin}
        <AdminPanel />
      {/if}

      {#if showShare && shareUrl}
        <div class="share">
          <div class="share-info">
            <p class="muted">{$t('Адрес для подключения других устройств:')}</p>
            <code class="share-url">{shareUrl}</code>
            <button class="ghost sm" onclick={copyShare}
              >{copied ? $t('Скопировано ✓') : $t('Копировать')}</button
            >
            <p class="muted">
              {$t('Откройте «Сервер» на другом устройстве и отсканируйте QR или введите адрес.')}
            </p>
          </div>
          <QrCode value={shareUrl} size={160} />
        </div>
      {/if}

      {#if wordsMsg}<p class="muted">{wordsMsg}</p>{/if}
      {#if marksMsg}<p class="muted">{marksMsg}</p>{/if}
      {#if $connectError}<p class="error">{$t($connectError)}</p>{/if}

      {#if !$session}
        <AuthScreen />
      {:else if $session.user.status === 'pending'}
        <p class="pending-note">
          {$t(
            'Ваша заявка ожидает одобрения учителем. После одобрения станут доступны книги класса. Можно нажать «Обновить статус».',
          )}
        </p>
      {/if}

      {#if $session && $session.user.status !== 'pending'}
        <div class="search-bar">
          <input
            type="search"
            bind:value={searchQ}
            placeholder={$t('Поиск книги по названию или автору')}
            onkeydown={(e) => e.key === 'Enter' && runSearch()}
          />
          <button class="primary sm" onclick={runSearch}>{$t('Найти')}</button>
          <button class="ghost sm" onclick={clearSearch}>{$t('Все книги')}</button>
          <button class="ghost sm" onclick={() => openCatalog('/opds')}>{$t('По разделам')}</button>
          {#if canUpload($session.user.role)}
            <button class="ghost sm" onclick={() => openCatalog('/opds/mine')}
              >{$t('Мои книги')}</button
            >
          {/if}
        </div>
      {/if}

      {#if $session && $session.user.status !== 'pending' && $catalog}
        <div class="feed-head">
          {#if $canCatalogBack}
            <button class="ghost sm" onclick={catalogBack}>
              <Icon name="close" size={16} /> {$t('Назад')}
            </button>
          {/if}
          <h2 class="feed-title">{$t($catalog.feed.title)}</h2>
        </div>
        {#if $catalog.feed.entries.length === 0}
          <p class="muted">{$t('Каталог пуст.')}</p>
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
              <span class="e-title">{$t(entry.title)}</span>
              {#if entry.authors.length}
                <span class="muted">{entry.authors.join(', ')}</span>
              {/if}
              {#if isBook(entry)}
                {@const localId = downloadedMap.get(serverIdOf(entry))}
                {#if localId}
                  <button class="primary sm" onclick={() => openLocal(localId)}
                    >{$t('Открыть')}</button
                  >
                  <span class="downloaded">{$t('✓ скачано')}</span>
                {:else}
                  <button
                    class="primary sm"
                    disabled={$downloading.has(entry.id || entry.acquisitionHref || '')}
                    onclick={() => downloadEntry(entry)}
                  >
                    {$downloading.has(entry.id || entry.acquisitionHref || '')
                      ? $t('Скачивание…')
                      : $t('Скачать')}
                  </button>
                {/if}
                {#if canDeleteHere}
                  <button
                    class="danger sm"
                    disabled={$deletingServer.has(serverIdOf(entry))}
                    title={$t('Удалить книгу с сервера')}
                    onclick={() => removeFromServer(entry)}
                  >
                    {$deletingServer.has(serverIdOf(entry))
                      ? $t('Удаление…')
                      : $t('Удалить с сервера')}
                  </button>
                {/if}
              {:else}
                {@const href = navHref(entry)}
                {#if href}
                  <button class="ghost sm" onclick={() => openCatalog(href, true)}
                    >{$t('Открыть')}</button
                  >
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {:else if $connecting}
        <p class="muted">{$t('Загрузка каталога…')}</p>
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
  /* Удаление книги с сервера — необратимое действие, поэтому отдельный вид. */
  .danger {
    border: 1px solid #c0392b;
    border-radius: 8px;
    background: transparent;
    color: #c0392b;
    padding: 0.55rem 0.9rem;
    cursor: pointer;
  }
  .danger.sm {
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
  }
  .danger:disabled {
    opacity: 0.6;
    cursor: default;
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
  .force-pw {
    max-width: 420px;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .force-pw h2 {
    margin: 0 0 0.4rem;
  }
  .force-pw p {
    color: var(--muted);
    font-size: 0.92rem;
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
