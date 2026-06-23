<script lang="ts">
  /** Смена собственного пароля (любой вошедший пользователь). */
  import { changeMyPassword } from './users';

  let open = $state(false);
  let oldPw = $state('');
  let newPw = $state('');
  let newPw2 = $state('');
  let busy = $state(false);
  let error = $state('');
  let done = $state(false);

  async function submit() {
    error = '';
    done = false;
    if (newPw.length < 4) {
      error = 'Новый пароль минимум 4 символа';
      return;
    }
    if (newPw !== newPw2) {
      error = 'Пароли не совпадают';
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
    {open ? 'Скрыть смену пароля' : 'Сменить пароль'}
  </button>
  {#if open}
    <div class="pw-form">
      <input type="password" bind:value={oldPw} placeholder="Текущий пароль" autocomplete="current-password" />
      <input type="password" bind:value={newPw} placeholder="Новый пароль (мин. 4)" autocomplete="new-password" />
      <input type="password" bind:value={newPw2} placeholder="Повторите новый" autocomplete="new-password" />
      <button class="primary sm" onclick={submit} disabled={busy}>Сменить</button>
      {#if error}<p class="error">{error}</p>{/if}
      {#if done}<p class="ok">Пароль изменён</p>{/if}
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
  .ok {
    color: #2e7d32;
    margin: 0;
    font-size: 0.85rem;
  }
</style>
