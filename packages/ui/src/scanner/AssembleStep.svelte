<script lang="ts">
  import type { OutputFormat } from '@reader/book-scanner';
  import { pages, finishScanner, assembleProgress, scannerBusy } from './store';
  import { settings } from '../stores';
  import { requestLlm } from '../components/llm-consent';

  let title = $state('');
  let author = $state('');
  let format = $state<OutputFormat>('cbz');
  let cleanup = $state(false);

  // pdf/epub доступны после подключения OCR (Фаза 2).
  const formats: { value: OutputFormat; label: string; ready: boolean; note: string }[] = [
    { value: 'cbz', label: 'CBZ (картинки)', ready: true, note: 'Быстро, без распознавания текста' },
    { value: 'epub', label: 'EPUB (текст, OCR)', ready: true, note: 'Распознаёт текст: работают TTS, шрифт, словарь. Дольше' },
    { value: 'pdf', label: 'Searchable PDF', ready: true, note: 'Картинки + невидимый OCR-текст: можно искать и копировать. Дольше' },
  ];

  const canBuild = $derived($pages.length > 0 && title.trim().length > 0 && !$scannerBusy);

  function build() {
    finishScanner(
      format,
      { title: title.trim(), author: author.trim() || undefined },
      { cleanup: format === 'epub' && cleanup },
    );
  }
</script>

<div class="assemble">
  <h3>Собрать книгу</h3>

  <label>
    Название
    <input type="text" bind:value={title} placeholder="Например: Учебник по биологии" />
  </label>
  <label>
    Автор (необязательно)
    <input type="text" bind:value={author} placeholder="Автор" />
  </label>

  <fieldset>
    <legend>Формат</legend>
    {#each formats as f}
      <label class="fmt" class:disabled={!f.ready}>
        <input
          type="radio"
          name="format"
          value={f.value}
          checked={format === f.value}
          disabled={!f.ready}
          onchange={() => (format = f.value)}
        />
        <span class="fmt-label">{f.label}</span>
        <span class="fmt-note">{f.note}</span>
      </label>
    {/each}
  </fieldset>

  {#if format === 'epub' && $settings.llmEnabled}
    <label class="opt">
      <input
        type="checkbox"
        checked={cleanup}
        onchange={async (e) => {
          const on = e.currentTarget.checked;
          cleanup = on ? await requestLlm() : false;
          e.currentTarget.checked = cleanup;
        }}
      />
      <span class="opt-label">
        Улучшить текст ИИ <span class="beta">β</span>
        <span class="opt-note">
          Локальная модель (бета) исправит ошибки распознавания и абзацы. Может
          ошибаться. Нужен запущенный Ollama/LM Studio, иначе текст останется как есть. Дольше.
        </span>
      </span>
    </label>
  {/if}

  {#if $assembleProgress}
    <div class="progress">
      <div
        class="bar"
        style:width={`${($assembleProgress.done / $assembleProgress.total) * 100}%`}
      ></div>
      <span>Сборка: {$assembleProgress.done} / {$assembleProgress.total}</span>
    </div>
  {/if}

  <button class="build" disabled={!canBuild} onclick={build}>
    Создать книгу ({$pages.length} стр.)
  </button>
</div>

<style>
  .assemble {
    margin-top: 1.5rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  h3 {
    margin: 0 0 0.8rem;
    color: var(--text);
  }
  label {
    display: block;
    margin-bottom: 0.7rem;
    color: var(--text);
    font-size: 0.9rem;
  }
  input[type='text'] {
    display: block;
    width: 100%;
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
  .fmt {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 0.5rem;
    margin: 0.35rem 0;
  }
  .fmt input {
    grid-row: span 2;
  }
  .fmt-label {
    font-weight: 600;
  }
  .fmt-note {
    grid-column: 2;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .fmt.disabled {
    opacity: 0.55;
  }
  .opt {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: start;
    column-gap: 0.5rem;
    margin: 0 0 0.8rem;
  }
  .opt-label {
    font-weight: 600;
    color: var(--text);
  }
  .beta {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: #d9a400;
    color: #1a1400;
  }
  .opt-note {
    display: block;
    margin-top: 0.2rem;
    font-weight: 400;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .progress {
    position: relative;
    height: 26px;
    margin-bottom: 0.8rem;
    border-radius: 8px;
    background: var(--border);
    overflow: hidden;
  }
  .progress .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .progress span {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    color: var(--text);
  }
  .build {
    width: 100%;
    padding: 0.8rem;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 1.05rem;
    font-weight: 700;
    cursor: pointer;
  }
  .build:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
