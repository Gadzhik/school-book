<script lang="ts">
  /**
   * Регистрация и вход (ТЗ Часть 6, п.6.2). Учитель выбирает предмет(ы) и
   * классы; ученик — класс. После регистрации статус «ожидает одобрения».
   * Вход доступен в любое время; сессия кэшируется для офлайн-входа.
   */
  import { onMount } from 'svelte';
  import { listSubjects, listClasses, type SubjectEntry, type ClassEntry } from '@reader/core';
  import { register, login, authBusy, authError } from './auth';
  import { serverStatus, connecting, connectError, connect, disconnect } from './store';

  let mode = $state<'login' | 'register'>('login');
  let role = $state<'student' | 'teacher'>('student');

  // --- Подключение к серверу (объединено с входом/регистрацией) ---
  // Поля сервера показываем, пока не подключены; submit входа/регистрации сам
  // сначала подключается к серверу, потом авторизуется — один экран, один шаг.
  let address = $state('');
  let token = $state('');
  const connected = $derived(!!$serverStatus);

  // Поиск серверов в LAN — только в нативной оболочке (Tauri). __TAURI__
  // читаем лениво (может появиться позже импорта модуля).
  interface DiscoveredServer { baseUrl: string; name?: string }
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

  /** Убедиться, что подключены к серверу (иначе подключиться по введённому адресу). */
  async function ensureConnected(): Promise<boolean> {
    if (connected) return true;
    if (!address.trim()) {
      connectError.set('Введите адрес сервера школы.');
      return false;
    }
    return await connect(address, token);
  }

  // Общие поля
  let fullName = $state('');
  let userLogin = $state('');
  let password = $state('');
  // Ученик
  let klass = $state('');
  // Учитель
  let pickedSubjects = $state<string[]>([]);
  let pickedClasses = $state<string[]>([]);

  let subjects = $state<SubjectEntry[]>([]);
  let classes = $state<ClassEntry[]>([]);

  onMount(async () => {
    subjects = await listSubjects();
    classes = await listClasses();
    hasTauri = !!tauriInvoke();
  });

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function submit() {
    if ($authBusy || $connecting) return;
    // Сначала подключаемся к серверу (если ещё не), затем авторизуемся.
    if (!(await ensureConnected())) return;
    if (mode === 'login') {
      await login({ login: userLogin.trim(), password });
      return;
    }
    await register({
      role,
      fullName: fullName.trim(),
      login: userLogin.trim(),
      password,
      subjects: role === 'teacher' ? pickedSubjects : undefined,
      classes: role === 'teacher' ? pickedClasses : undefined,
      class: role === 'student' ? klass : undefined,
    });
  }
</script>

<section class="auth">
  {#if connected}
    <p class="server-line">
      Сервер: <strong>{$serverStatus?.name ?? 'подключён'}</strong>
      <button class="link" onclick={disconnect}>сменить</button>
    </p>
  {:else}
    <div class="srv">
      <input
        type="text"
        bind:value={address}
        placeholder="Адрес сервера школы, напр. 192.168.1.10:9700"
      />
      <input type="text" bind:value={token} placeholder="Код доступа (если нужен)" />
      <div class="srv-actions">
        {#if hasTauri}
          <button type="button" class="ghost" onclick={discover} disabled={discovering}>
            {discovering ? 'Поиск…' : 'Найти сервер в сети'}
          </button>
        {/if}
        <button type="button" class="ghost" onclick={() => (address = '10.0.2.2:9700')}>
          Android-эмулятор
        </button>
      </div>
      {#if discovered.length}
        <ul class="discovered">
          {#each discovered as srv (srv.baseUrl)}
            <li>
              <span class="d-name">{srv.name ?? srv.baseUrl}</span>
              <button type="button" class="link" onclick={() => connect(srv.baseUrl)}>выбрать</button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <div class="tabs">
    <button class:active={mode === 'login'} onclick={() => (mode = 'login')}>Вход</button>
    <button class:active={mode === 'register'} onclick={() => (mode = 'register')}>Регистрация</button>
  </div>

  {#if mode === 'register'}
    <div class="roles">
      <label class:sel={role === 'student'}>
        <input type="radio" name="role" value="student" bind:group={role} /> Ученик
      </label>
      <label class:sel={role === 'teacher'}>
        <input type="radio" name="role" value="teacher" bind:group={role} /> Учитель
      </label>
    </div>

    <label class="fld">
      Имя, фамилия, отчество
      <input type="text" bind:value={fullName} placeholder="Иванов Иван Иванович" />
    </label>
  {/if}

  <label class="fld">
    Логин
    <input type="text" bind:value={userLogin} autocomplete="username" placeholder="ivan7a" />
  </label>
  <label class="fld">
    Пароль
    <input
      type="password"
      bind:value={password}
      autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
      onkeydown={(e) => e.key === 'Enter' && submit()}
    />
  </label>

  {#if mode === 'register' && role === 'student'}
    <label class="fld">
      Класс
      <select bind:value={klass}>
        <option value="" disabled>Выберите класс</option>
        {#each classes as c (c.id)}
          <option value={c.id}>{c.label}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if mode === 'register' && role === 'teacher'}
    <fieldset>
      <legend>Предметы</legend>
      <div class="chips">
        {#each subjects as s (s.id)}
          <button
            type="button"
            class="chip"
            class:on={pickedSubjects.includes(s.id)}
            onclick={() => (pickedSubjects = toggle(pickedSubjects, s.id))}
          >
            {s.name}
          </button>
        {/each}
      </div>
    </fieldset>
    <fieldset>
      <legend>Классы</legend>
      <div class="chips">
        {#each classes as c (c.id)}
          <button
            type="button"
            class="chip"
            class:on={pickedClasses.includes(c.id)}
            onclick={() => (pickedClasses = toggle(pickedClasses, c.id))}
          >
            {c.label}
          </button>
        {/each}
      </div>
    </fieldset>
  {/if}

  {#if $connectError}<p class="error">{$connectError}</p>{/if}
  {#if $authError}<p class="error">{$authError}</p>{/if}

  <button class="primary" onclick={submit} disabled={$authBusy || $connecting}>
    {$connecting
      ? 'Подключение…'
      : $authBusy
        ? 'Подождите…'
        : mode === 'login'
          ? 'Войти'
          : 'Зарегистрироваться'}
  </button>

  {#if mode === 'register'}
    <p class="note">
      После регистрации учитель должен одобрить вашу заявку. До одобрения доступ ограничен.
    </p>
  {/if}
</section>

<style>
  .auth {
    max-width: 460px;
    margin: 0 auto;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .srv {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  .srv input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-size: 1rem;
  }
  .srv-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    padding: 0.5rem 0.8rem;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .ghost:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .server-line {
    margin: 0 0 1rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .link {
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    font: inherit;
  }
  .discovered {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .discovered li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
  }
  .d-name {
    font-weight: 600;
    color: var(--text);
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .tabs button {
    flex: 1;
    padding: 0.55rem;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
  }
  .tabs button.active {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .roles {
    display: flex;
    gap: 0.6rem;
    margin-bottom: 0.8rem;
  }
  .roles label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 9px;
    cursor: pointer;
    color: var(--text);
  }
  .roles label.sel {
    border-color: var(--accent);
  }
  .fld {
    display: block;
    margin-bottom: 0.7rem;
    color: var(--text);
    font-size: 0.9rem;
  }
  .fld input,
  .fld select {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.25rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-size: 1rem;
  }
  fieldset {
    margin: 0 0 0.8rem;
    padding: 0.5rem 0.8rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  legend {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 0 0.3rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .primary {
    width: 100%;
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.7rem;
    font-size: 1.05rem;
    font-weight: 700;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    color: #c0392b;
  }
  .note {
    margin: 0.8rem 0 0;
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.4;
  }
</style>
