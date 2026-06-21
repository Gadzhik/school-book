<script lang="ts">
  import type {
    ThemeName,
    FontFamilyChoice,
    TextAlign,
    ReadingFlow,
    ColumnCount,
  } from '@reader/core';
  import { settings, patchSettings, readerIsFixedLayout } from '../stores';
  import Icon from './Icon.svelte';

  interface Props {
    onclose: () => void;
  }
  const { onclose }: Props = $props();

  const themes: { value: ThemeName; label: string }[] = [
    { value: 'light', label: 'Светлая' },
    { value: 'dark', label: 'Тёмная' },
    { value: 'sepia', label: 'Сепия' },
    { value: 'high-contrast', label: 'Контраст' },
  ];
  const fonts: { value: FontFamilyChoice; label: string }[] = [
    { value: 'serif', label: 'С засечками' },
    { value: 'sans', label: 'Без засечек' },
    { value: 'dyslexic', label: 'Для дислексии' },
  ];
  const aligns: { value: TextAlign; label: string }[] = [
    { value: 'start', label: 'По левому краю' },
    { value: 'justify', label: 'По ширине' },
  ];
  const flows: { value: ReadingFlow; label: string }[] = [
    { value: 'paginated', label: 'Страницы' },
    { value: 'scrolled', label: 'Прокрутка' },
  ];
  const columnOpts: { value: ColumnCount; label: string }[] = [
    { value: 1, label: '1 колонка' },
    { value: 2, label: '2 колонки' },
  ];
</script>

<aside class="panel" aria-label="Настройки чтения">
  <header>
    <h2>Настройки чтения</h2>
    <button class="icon-btn" onclick={onclose} aria-label="Закрыть настройки">
      <Icon name="close" />
    </button>
  </header>

  {#if $readerIsFixedLayout}
    <p class="note">
      Это PDF с фиксированной вёрсткой. Текст в нём не перетекает, поэтому
      настройки шрифта, интервала, полей и колонок могут не действовать —
      надёжно работают только тема и масштаб (через «Размер шрифта» при 1/2
      колонках). Полная настройка появится после распознавания текста (OCR).
    </p>
  {/if}

  <section>
    <h3>Тема</h3>
    <div class="chips">
      {#each themes as t}
        <button
          class="chip"
          class:active={$settings.theme === t.value}
          onclick={() => patchSettings({ theme: t.value })}
        >
          {t.label}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Шрифт</h3>
    <div class="chips">
      {#each fonts as f}
        <button
          class="chip"
          class:active={$settings.fontFamily === f.value}
          onclick={() => patchSettings({ fontFamily: f.value })}
        >
          {f.label}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Размер шрифта: {$settings.fontSize}%</h3>
    <input
      type="range"
      min="70"
      max="220"
      step="5"
      value={$settings.fontSize}
      oninput={(e) => patchSettings({ fontSize: +e.currentTarget.value })}
    />
  </section>

  <section>
    <h3>Межстрочный интервал: {$settings.lineHeight}</h3>
    <input
      type="range"
      min="1"
      max="2.4"
      step="0.1"
      value={$settings.lineHeight}
      oninput={(e) => patchSettings({ lineHeight: +e.currentTarget.value })}
    />
  </section>

  <section>
    <h3>Поля: {$settings.margin}%</h3>
    <input
      type="range"
      min="0"
      max="16"
      step="1"
      value={$settings.margin}
      oninput={(e) => patchSettings({ margin: +e.currentTarget.value })}
    />
  </section>

  <section>
    <h3>Выравнивание</h3>
    <div class="chips">
      {#each aligns as a}
        <button
          class="chip"
          class:active={$settings.textAlign === a.value}
          onclick={() => patchSettings({ textAlign: a.value })}
        >
          {a.label}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Режим чтения</h3>
    <div class="chips">
      {#each flows as f}
        <button
          class="chip"
          class:active={$settings.flow === f.value}
          onclick={() => patchSettings({ flow: f.value })}
        >
          {f.label}
        </button>
      {/each}
    </div>
  </section>

  {#if $settings.flow === 'paginated'}
    <section>
      <h3>Колонки</h3>
      <div class="chips">
        {#each columnOpts as c}
          <button
            class="chip"
            class:active={$settings.columns === c.value}
            onclick={() => patchSettings({ columns: c.value })}
          >
            {c.label}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h3>Линейка чтения</h3>
    <div class="chips">
      <button
        class="chip"
        class:active={!$settings.readingRuler}
        onclick={() => patchSettings({ readingRuler: false })}
      >
        Выкл
      </button>
      <button
        class="chip"
        class:active={$settings.readingRuler}
        onclick={() => patchSettings({ readingRuler: true })}
      >
        Вкл
      </button>
    </div>
  </section>

  <section>
    <h3>Серия чтения</h3>
    <div class="chips">
      <button
        class="chip"
        class:active={!$settings.gamification}
        onclick={() => patchSettings({ gamification: false })}
      >
        Выкл
      </button>
      <button
        class="chip"
        class:active={$settings.gamification}
        onclick={() => patchSettings({ gamification: true })}
      >
        Вкл
      </button>
    </div>
  </section>

  <section>
    <h3>Режим e-ink</h3>
    <div class="chips">
      <button
        class="chip"
        class:active={!$settings.eink}
        onclick={() => patchSettings({ eink: false })}
      >
        Выкл
      </button>
      <button
        class="chip"
        class:active={$settings.eink}
        onclick={() => patchSettings({ eink: true })}
      >
        Вкл
      </button>
    </div>
  </section>

  <section>
    <h3>Формулы (KaTeX)</h3>
    <div class="chips">
      <button class="chip" class:active={!$settings.math} onclick={() => patchSettings({ math: false })}>
        Выкл
      </button>
      <button class="chip" class:active={$settings.math} onclick={() => patchSettings({ math: true })}>
        Вкл
      </button>
    </div>
  </section>

  <section>
    <h3>ИИ-помощник</h3>
    <div class="chips">
      <button
        class="chip"
        class:active={$settings.llmProvider === 'ollama'}
        onclick={() => patchSettings({ llmProvider: 'ollama' })}
      >
        Ollama
      </button>
      <button
        class="chip"
        class:active={$settings.llmProvider === 'lmstudio'}
        onclick={() => patchSettings({ llmProvider: 'lmstudio' })}
      >
        LM Studio
      </button>
    </div>
    <input
      class="field"
      type="text"
      placeholder={$settings.llmProvider === 'lmstudio'
        ? 'URL (по умолчанию http://localhost:1234)'
        : 'URL (по умолчанию http://localhost:11434)'}
      value={$settings.llmUrl}
      oninput={(e) => patchSettings({ llmUrl: e.currentTarget.value.trim() })}
    />
    <input
      class="field"
      type="text"
      placeholder={$settings.llmProvider === 'lmstudio'
        ? 'Модель (пусто — первая загруженная)'
        : 'Модель (по умолчанию llama3.2)'}
      value={$settings.llmModel}
      oninput={(e) => patchSettings({ llmModel: e.currentTarget.value.trim() })}
    />
    <p class="hint">
      Для веб-клиента включите CORS: Ollama — <code>OLLAMA_ORIGINS=*</code>; LM Studio — Developer →
      Enable CORS.
    </p>
  </section>

  <section>
    <h3>Озвучивание</h3>
    <div class="chips">
      <button
        class="chip"
        class:active={!$settings.nativeTts}
        onclick={() => patchSettings({ nativeTts: false })}
      >
        Браузер
      </button>
      <button
        class="chip"
        class:active={$settings.nativeTts}
        onclick={() => patchSettings({ nativeTts: true })}
      >
        Системный
      </button>
    </div>
    <p class="hint">
      Системный голос (в приложении) — лучше на телефоне, где у браузера нет
      голосов. Без подсветки слова. В вебе всегда озвучивает браузер.
    </p>
  </section>

  <section>
    <h3>Конвертер документов</h3>
    <div class="chips">
      <button
        class="chip"
        class:active={!$settings.pandocDocs}
        onclick={() => patchSettings({ pandocDocs: false })}
      >
        Встроенный
      </button>
      <button
        class="chip"
        class:active={$settings.pandocDocs}
        onclick={() => patchSettings({ pandocDocs: true })}
      >
        pandoc
      </button>
    </div>
    <p class="hint">
      pandoc (DOCX/RTF/ODT/HTML/MD→EPUB) точнее, но тяжёлый: ~58 МБ загрузятся при
      первом использовании. Встроенный — быстрый и лёгкий.
    </p>
  </section>
</aside>

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(340px, 92vw);
    background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.25);
    padding: 1rem 1.2rem 2rem;
    overflow-y: auto;
    z-index: 30;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text);
  }
  section {
    margin-bottom: 1.3rem;
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    color: var(--text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .chip.active {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .field {
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.88rem;
    box-sizing: border-box;
  }
  .hint {
    margin: 0.5rem 0 0;
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .hint code {
    background: var(--bg);
    padding: 0 0.25rem;
    border-radius: 4px;
  }
  .note {
    margin: 0 0 1.3rem;
    padding: 0.6rem 0.7rem;
    border-radius: 8px;
    background: var(--bg);
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.4;
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
