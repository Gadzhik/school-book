<script lang="ts">
  /**
   * Управление пользователями (админ/power): создать, сменить роль,
   * заблокировать/разблокировать, удалить. Серверные права — источник истины.
   */
  import { onMount } from 'svelte';
  import type { Role } from '@reader/network';
  import { session } from './auth';
  import {
    usersList,
    usersBusy,
    usersError,
    assignableRoles,
    loadUsers,
    createUser,
    changeRole,
    setBlocked,
    removeUser,
    resetPassword,
  } from './users';
  import { t, tr } from '../i18n';

  const ROLE_LABEL: Record<Role, string> = {
    admin: 'Администратор',
    power: 'Старший',
    teacher: 'Учитель',
    student: 'Ученик',
  };
  const STATUS_LABEL: Record<string, string> = {
    active: 'активен',
    pending: 'ожидает',
    blocked: 'заблокирован',
  };

  // Роли, которые текущий пользователь вправе назначать.
  const roles = $derived(assignableRoles($session?.user.role));
  const myId = $derived($session?.user.id);

  // Форма создания.
  let showCreate = $state(false);
  let fullName = $state('');
  let login = $state('');
  let password = $state('');
  let role = $state<Role>('student');
  let classes = $state('');
  let subjects = $state('');

  onMount(loadUsers);

  function csv(s: string): string[] {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  // Клиентская пред-проверка силы пароля (авторитетная — на сервере).
  function weakPassword(pw: string): boolean {
    return pw.length < 8 || !/\p{L}/u.test(pw) || !/\d/.test(pw);
  }

  async function submitCreate() {
    if (!fullName.trim() || !login.trim()) return;
    if (weakPassword(password)) {
      usersError.set(tr('Пароль должен быть не короче 8 символов и содержать буквы и цифры'));
      return;
    }
    const ok = await createUser({
      fullName: fullName.trim(),
      login: login.trim(),
      password,
      role,
      classes: csv(classes),
      subjects: role === 'teacher' ? csv(subjects) : [],
    });
    if (ok) {
      fullName = '';
      login = '';
      password = '';
      role = 'student';
      classes = '';
      subjects = '';
      showCreate = false;
    }
  }

  async function onDelete(id: string, name: string) {
    if (confirm(tr('Удалить пользователя «{0}»? Действие необратимо.', name))) {
      await removeUser(id);
    }
  }

  async function onResetPw(id: string, name: string) {
    const pw = prompt(
      tr('Новый пароль для «{0}» (не короче 8 символов, обязательно буквы и цифры):', name)
    );
    if (pw === null) return;
    if (weakPassword(pw)) {
      usersError.set(tr('Пароль должен быть не короче 8 символов и содержать буквы и цифры'));
      return;
    }
    const err = await resetPassword(id, pw);
    usersError.set(err ?? '');
    if (!err) alert(tr('Пароль для «{0}» изменён.', name));
  }
</script>

<section class="users">
  <div class="bar">
    <h2>{$t('Пользователи')}</h2>
    <button class="ghost sm" onclick={loadUsers} disabled={$usersBusy}>{$t('Обновить')}</button>
    <button class="primary sm" onclick={() => (showCreate = !showCreate)}>
      {showCreate ? $t('Отмена') : $t('+ Добавить')}
    </button>
  </div>

  {#if $usersError}<p class="error">{$t($usersError)}</p>{/if}

  {#if showCreate}
    <div class="create">
      <input type="text" bind:value={fullName} placeholder={$t('Имя и фамилия')} />
      <!-- Логин регистрозависимый — глушим автокапитализацию мобильной клавиатуры. -->
      <input
        type="text"
        bind:value={login}
        placeholder={$t('Логин')}
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
      />
      <input
        type="password"
        bind:value={password}
        placeholder={$t('Пароль')}
        autocomplete="new-password"
      />
      <p class="pw-hint">{$t('Не короче 8 символов, обязательно буквы и цифры, не совпадает с логином.')}</p>
      <select bind:value={role}>
        {#each roles as r (r)}
          <option value={r}>{$t(ROLE_LABEL[r])}</option>
        {/each}
      </select>
      <input
        type="text"
        bind:value={classes}
        placeholder={$t('Классы через запятую (напр. 5А, 6Б)')}
      />
      {#if role === 'teacher'}
        <input type="text" bind:value={subjects} placeholder={$t('Предметы через запятую')} />
      {/if}
      <button class="primary sm" onclick={submitCreate} disabled={$usersBusy}>{$t('Создать')}</button>
    </div>
  {/if}

  {#if $usersList.length === 0}
    <p class="muted">{$t('Пользователей нет.')}</p>
  {:else}
    <ul>
      {#each $usersList as u (u.id)}
        <li class:blocked={u.status === 'blocked'}>
          <span class="u-name">{u.fullName}</span>
          <span class="u-login">@{u.login}</span>
          {#if u.id === myId}
            <span class="role-static">{$t('{0} (вы)', $t(ROLE_LABEL[u.role]))}</span>
          {:else}
            <select
              class="role-sel"
              value={u.role}
              disabled={$usersBusy || !roles.includes(u.role)}
              onchange={(e) => changeRole(u.id, (e.currentTarget as HTMLSelectElement).value as Role)}
            >
              <!-- Текущая роль показывается всегда; назначаемые — из прав. -->
              {#if !roles.includes(u.role)}
                <option value={u.role}>{$t(ROLE_LABEL[u.role])}</option>
              {/if}
              {#each roles as r (r)}
                <option value={r}>{$t(ROLE_LABEL[r])}</option>
              {/each}
            </select>
          {/if}
          <span class="status {u.status}">{$t(STATUS_LABEL[u.status] ?? u.status)}</span>
          {#if u.classes.length}<span class="tag">{$t('кл. {0}', u.classes.join(', '))}</span>{/if}
          <span class="spacer"></span>
          {#if u.id !== myId}
            {#if u.status === 'blocked'}
              <button class="ghost sm" onclick={() => setBlocked(u.id, false)} disabled={$usersBusy}>
                {$t('Разблокировать')}
              </button>
            {:else}
              <button class="ghost sm" onclick={() => setBlocked(u.id, true)} disabled={$usersBusy}>
                {$t('Заблокировать')}
              </button>
            {/if}
            <button class="ghost sm" onclick={() => onResetPw(u.id, u.fullName)} disabled={$usersBusy}>
              {$t('Сбросить пароль')}
            </button>
            <button class="danger sm" onclick={() => onDelete(u.id, u.fullName)} disabled={$usersBusy}>
              {$t('Удалить')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .users {
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
  .create {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.7rem 0;
    padding: 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .create input,
  .create select,
  .role-sel {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  ul {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
  }
  li.blocked {
    opacity: 0.6;
  }
  .u-name {
    font-weight: 600;
    color: var(--text);
  }
  .u-login {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .role-static {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .status {
    font-size: 0.8rem;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg);
    color: var(--muted);
  }
  .status.active {
    color: #2e7d32;
  }
  .status.blocked {
    color: #c0392b;
  }
  .status.pending {
    color: #b8860b;
  }
  .tag {
    font-size: 0.78rem;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 6px;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: #c0392b;
  }
  .pw-hint {
    color: var(--muted);
    margin: -0.2rem 0 0;
    font-size: 0.78rem;
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
    border: 1px solid #c0392b;
    border-radius: 8px;
    background: transparent;
    color: #c0392b;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .primary:disabled,
  .ghost:disabled,
  .danger:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
