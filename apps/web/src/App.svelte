<script lang="ts">
  import { Library, Reader, view, settings, applyAppTheme } from '@reader/ui';
  // Экран сканера подключаем через subpath, не трогая публичный индекс @reader/ui.
  import ScannerScreen from '@reader/ui/scanner/ScannerScreen.svelte';
  import WordsScreen from '@reader/ui/words/WordsScreen.svelte';
  import ServerScreen from '@reader/ui/server/ServerScreen.svelte';
  import ReportScreen from '@reader/ui/components/ReportScreen.svelte';

  // Применяем тему оформления при каждом изменении настроек.
  $effect(() => {
    applyAppTheme($settings.theme);
  });

  // Режим e-ink: класс на корне отключает анимации/тени в обвязке (ТЗ 3 п.9).
  $effect(() => {
    document.documentElement.classList.toggle('eink', $settings.eink);
  });
</script>

{#if $view.name === 'reader'}
  <Reader bookId={$view.bookId} />
{:else if $view.name === 'scanner'}
  <ScannerScreen />
{:else if $view.name === 'words'}
  <WordsScreen />
{:else if $view.name === 'server'}
  <ServerScreen />
{:else if $view.name === 'report'}
  <ReportScreen />
{:else}
  <Library />
{/if}
