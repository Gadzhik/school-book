<script lang="ts">
  import { pages, scannerError, cancelScanner, scannerSupported } from './store';
  import CaptureStep from './CaptureStep.svelte';
  import PageStrip from './PageStrip.svelte';
  import AssembleStep from './AssembleStep.svelte';
  import Icon from '../components/Icon.svelte';

  const supported = scannerSupported();
</script>

<div class="screen">
  <header class="bar">
    <button class="icon-btn" onclick={() => cancelScanner()} aria-label="Отмена">
      <Icon name="back" />
    </button>
    <h1>Создать книгу из фото</h1>
  </header>

  <div class="body">
    {#if !supported}
      <p class="warn">
        Сканер недоступен: браузер не поддерживает локальное файловое хранилище
        (OPFS). Откройте приложение в установленном виде или в другом браузере.
      </p>
    {:else}
      <CaptureStep />

      {#if $scannerError}
        <p class="error">{$scannerError}</p>
      {/if}

      {#if $pages.length > 0}
        <PageStrip />
        <AssembleStep />
      {:else}
        <p class="empty">Пока нет страниц. Снимите или загрузите первую.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .bar h1 {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text);
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  .empty {
    margin-top: 1.5rem;
    text-align: center;
    color: var(--muted);
  }
  .warn,
  .error {
    padding: 0.8rem 1rem;
    border-radius: 10px;
  }
  .warn {
    background: var(--surface);
    color: var(--text);
  }
  .error {
    margin-top: 0.8rem;
    background: #fdecea;
    color: #b3261e;
  }
  .icon-btn {
    display: flex;
    padding: 6px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--border);
  }
</style>
