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

  async function submitCreate() {
    if (!fullName.trim() || !login.trim() || password.length < 4) return;
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
    if (confirm(`Удалить пользователя «${name}»? Действие необратимо.`)) {
      await removeUser(id);
    }
  }

  async function onResetPw(id: string, name: string) {
    const pw = prompt(`Новый пароль для «${name}» (минимум 4 символа):`);
    if (pw === null) return;
    if (pw.length < 4) {
      usersError.set('Пароль минимум 4 символа');
      return;
    }
    const err = await resetPassword(id, pw);
    usersError.set(err ?? '');
    if (!err) alert(`Пароль для «${name}» изменён.`);
  }
</script>

<section class="users">
  <div class="bar">
    <h2>Пользователи</h2>
    <button class="ghost sm" onclick={loadUsers} disabled={$usersBusy}>Обновить</button>
    <button class="primary sm" onclick={() => (showCreate = !showCreate)}>
      {showCreate ? 'Отмена' : '+ Добавить'}
    </button>
  </div>

  {#if $usersError}<p class="error">{$usersError}</p>{/if}

  {#if showCreate}
    <div class="create">
      <input type="text" bind:value={fullName} placeholder="Имя и фамилия" />
      <input type="text" bind:value={login} placeholder="Логин" autocomplete="off" />
      <input type="password" bind:value={password} placeholder="Пароль (мин. 4)" autocomplete="new-password" />
      <select bind:value={role}>
        {#each roles as r (r)}
          <option value={r}>{ROLE_LABEL[r]}</option>
        {/each}
      </select>
      <input type="text" bind:value={classes} placeholder="Классы через запятую (напр. 5А, 6Б)" />
      {#if role === 'teacher'}
        <input type="text" bind:value={subjects} placeholder="Предметы через запятую" />
      {/if}
      <button class="primary sm" onclick={submitCreate} disabled={$usersBusy}>Создать</button>
    </div>
  {/if}

  {#if $usersList.length === 0}
    <p class="muted">Пользователей нет.</p>
  {:else}
    <ul>
      {#each $usersList as u (u.id)}
        <li class:blocked={u.status === 'blocked'}>
          <span class="u-name">{u.fullName}</span>
          <span class="u-login">@{u.login}</span>
          {#if u.id === myId}
            <span class="role-static">{ROLE_LABEL[u.role]} (вы)</span>
          {:else}
            <select
              class="role-sel"
              value={u.role}
              disabled={$usersBusy || !roles.includes(u.role)}
              onchange={(e) => changeRole(u.id, (e.currentTarget as HTMLSelectElement).value as Role)}
            >
              <!-- Текущая роль показывается всегда; назначаемые — из прав. -->
              {#if !roles.includes(u.role)}
                <option value={u.role}>{ROLE_LABEL[u.role]}</option>
              {/if}
              {#each roles as r (r)}
                <option value={r}>{ROLE_LABEL[r]}</option>
              {/each}
            </select>
          {/if}
          <span class="status {u.status}">{STATUS_LABEL[u.status] ?? u.status}</span>
          {#if u.classes.length}<span class="tag">кл. {u.classes.join(', ')}</span>{/if}
          <span class="spacer"></span>
          {#if u.id !== myId}
            {#if u.status === 'blocked'}
              <button class="ghost sm" onclick={() => setBlocked(u.id, false)} disabled={$usersBusy}>
                Разблокировать
              </button>
            {:else}
              <button class="ghost sm" onclick={() => setBlocked(u.id, true)} disabled={$usersBusy}>
                Заблокировать
              </button>
            {/if}
            <button class="ghost sm" onclick={() => onResetPw(u.id, u.fullName)} disabled={$usersBusy}>
              Сбросить пароль
            </button>
            <button class="danger sm" onclick={() => onDelete(u.id, u.fullName)} disabled={$usersBusy}>
              Удалить
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
