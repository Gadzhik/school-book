<script lang="ts">
  /** Смена собственного пароля (любой вошедший пользователь). */
  import { changeMyPassword } from './users';
  import { t, tr } from '../i18n';

  let open = $state(false);
  let oldPw = $state('');
  let newPw = $state('');
  let newPw2 = $state('');
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  // Клиентская пред-проверка силы пароля (авторитетная — на сервере,
  // включая сравнение с логином): ≥8 символов, есть буквы и цифры.
  function weakPassword(pw: string): boolean {
    return pw.length < 8 || !/\p{L}/u.test(pw) || !/\d/.test(pw);
  }

  async function submit() {
    error = '';
    done = false;
    if (weakPassword(newPw)) {
      error = tr('Пароль должен быть не короче 8 символов и содержать буквы и цифры');
      return;
    }
    if (newPw !== newPw2) {
      error = tr('Пароли не совпадают');
      return;
    }
    busy = true;
    const err = await changeMyPassword(oldPw, newPw);
    busy = false;
    if (err) {
      error = err;
      return;
    }
    done = true;
    oldPw = '';
    newPw = '';
    newPw2 = '';
    setTimeout(() => {
      done = false;
      open = false;
    }, 1500);
  }
</script>

<div class="pw">
  <button class="ghost sm" onclick={() => (open = !open)}>
    {open ? $t('Скрыть смену пароля') : $t('Сменить пароль')}
  </button>
  {#if open}
    <div class="pw-form">
      <input
        type="password"
        bind:value={oldPw}
        placeholder={$t('Текущий пароль')}
        autocomplete="current-password"
      />
      <input
        type="password"
        bind:value={newPw}
        placeholder={$t('Новый пароль')}
        autocomplete="new-password"
      />
      <p class="hint">{$t('Не короче 8 символов, обязательно буквы и цифры, не совпадает с логином.')}</p>
      <input
        type="password"
        bind:value={newPw2}
        placeholder={$t('Повторите новый')}
        autocomplete="new-password"
      />
      <button class="primary sm" onclick={submit} disabled={busy}>{$t('Сменить')}</button>
      {#if error}<p class="error">{$t(error)}</p>{/if}
      {#if done}<p class="ok">{$t('Пароль изменён')}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .pw {
    margin-top: 0.6rem;
  }
  .pw-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding: 0.7rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    max-width: 320px;
  }
  .pw-form input {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .primary {
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.4rem 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
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
  .error {
    color: #c0392b;
    margin: 0;
    font-size: 0.85rem;
  }
  .hint {
    color: var(--muted);
    margin: -0.2rem 0 0;
    font-size: 0.78rem;
  }
  .ok {
    color: #2e7d32;
    margin: 0;
    font-size: 0.85rem;
  }
</style>
