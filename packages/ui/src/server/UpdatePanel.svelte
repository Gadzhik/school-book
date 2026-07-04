<script lang="ts">
  /**
   * Вкладка «Доступно обновление»: сервер раздаёт новые сборки приложения
   * (папка обновлений: manifest.json + APK/инсталляторы). Показывается,
   * только когда версия в манифесте новее установленной (store.checkUpdate).
   *
   * Платформы:
   *  - web — приложение раздаётся самим сервером: обновляем Service Worker
   *    и перезагружаем страницу;
   *  - android/windows/linux (Tauri) — скачиваем файл по ссылке (openUrl
   *    через плагин opener, иначе window.open) и ставим вручную.
   */
  import { updateInfo, appVersion, currentClient, checkUpdate } from './store';
  import { t } from '../i18n';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tauri = typeof window !== 'undefined' ? (window as any).__TAURI__ : undefined;

  type Platform = 'web' | 'android' | 'windows' | 'linux';
  function platform(): Platform {
    if (typeof navigator === 'undefined') return 'web';
    const ua = navigator.userAgent;
    if (!tauri) return 'web';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows/i.test(ua)) return 'windows';
    return 'linux';
  }
  const plat = platform();

  const PLATFORM_LABEL: Record<string, string> = {
    android: 'Android (APK)',
    windows: 'Windows',
    linux: 'Linux',
  };

  // Файл для своей платформы; если его нет — покажем все доступные.
  const myFile = $derived($updateInfo?.files?.[plat]);
  const allFiles = $derived(Object.entries($updateInfo?.files ?? {}));

  let busy = $state(false);

  function fileUrl(file: string): string {
    return currentClient()?.updateFileUrl(file) ?? '';
  }

  /** Открыть ссылку скачивания: в Tauri — системно (opener), иначе новая вкладка. */
  async function download(file: string) {
    const url = fileUrl(file);
    if (!url) return;
    try {
      if (tauri?.opener?.openUrl) {
        await tauri.opener.openUrl(url);
        return;
      }
    } catch {
      /* не удалось системно — упадём на window.open */
    }
    window.open(url, '_blank');
  }

  /** Web: подтянуть свежий Service Worker и перезагрузить приложение. */
  async function reloadApp() {
    busy = true;
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    } catch {
      /* SW нет (dev) — просто перезагрузим */
    }
    location.reload();
  }
</script>

{#if $updateInfo}
  <section class="update">
    <div class="u-head">
      <span class="u-title">{$t('Доступно обновление')}</span>
      <span class="u-ver">{appVersion()} → {$updateInfo.version}</span>
    </div>
    {#if $updateInfo.notes}
      <p class="u-notes">{$updateInfo.notes}</p>
    {/if}

    {#if plat === 'web'}
      <p class="u-hint">
        {$t('Приложение раздаёт сам сервер — достаточно перезагрузить страницу.')}
      </p>
      <button class="primary sm" onclick={reloadApp} disabled={busy}>
        {busy ? $t('Обновление…') : $t('Обновить приложение')}
      </button>
    {:else if myFile}
      <p class="u-hint">
        {$t('Скачайте новую версию и установите поверх текущей. Данные (книги, прогресс, слова) сохранятся.')}
      </p>
      <button class="primary sm" onclick={() => download(myFile)}>
        {$t('Скачать для {0}', PLATFORM_LABEL[plat] ?? plat)}
      </button>
    {:else if allFiles.length}
      <p class="u-hint">{$t('Для этой платформы файла нет; доступные сборки:')}</p>
      <div class="u-files">
        {#each allFiles as [p, f] (p)}
          <button class="ghost sm" onclick={() => download(f)}>
            {PLATFORM_LABEL[p] ?? p}
          </button>
        {/each}
      </div>
    {:else}
      <p class="u-hint">{$t('Файлы обновления ещё не выложены на сервер.')}</p>
    {/if}

    <button class="ghost sm u-recheck" onclick={() => void checkUpdate()}>
      {$t('Проверить ещё раз')}
    </button>
  </section>
{/if}

<style>
  .update {
    margin-top: 1rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--accent);
    border-radius: 12px;
    background: var(--surface);
  }
  .u-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }
  .u-title {
    font-weight: 700;
    color: var(--accent);
  }
  .u-ver {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .u-notes,
  .u-hint {
    margin: 0 0 0.6rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .u-files {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }
  .primary {
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.55rem 1rem;
    font-weight: 700;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    padding: 0.55rem 1rem;
    cursor: pointer;
  }
  .sm {
    font-size: 0.9rem;
  }
  .u-recheck {
    margin-top: 0.2rem;
  }
</style>
