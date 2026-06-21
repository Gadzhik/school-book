<script lang="ts">
  /**
   * Регистрация и вход (ТЗ Часть 6, п.6.2). Учитель выбирает предмет(ы) и
   * классы; ученик — класс. После регистрации статус «ожидает одобрения».
   * Вход доступен в любое время; сессия кэшируется для офлайн-входа.
   */
  import { onMount } from 'svelte';
  import { listSubjects, listClasses, type SubjectEntry, type ClassEntry } from '@reader/core';
  import { register, login, authBusy, authError } from './auth';

  let mode = $state<'login' | 'register'>('login');
  let role = $state<'student' | 'teacher'>('student');

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
  });

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function submit() {
    if ($authBusy) return;
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

  {#if $authError}<p class="error">{$authError}</p>{/if}

  <button class="primary" onclick={submit} disabled={$authBusy}>
    {$authBusy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
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
