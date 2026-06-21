<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    getBook,
    getBookFile,
    saveProgress,
    updateBook,
    addBook,
    addBookmark,
    listBookmarks,
    removeBookmark,
    addHighlight as saveHighlight,
    listHighlights,
    getHighlightByCfi,
    setHighlightNote,
    removeHighlight as deleteHighlightDb,
    type BookMeta,
    type Bookmark,
    type Highlight,
  } from '@reader/core';
  import { pushProgress, pullProgress, subscribeProgress, type RemoteProgress } from '../server/progress';
  import type { ProgressSocket } from '@reader/network';
  import {
    pdfToEpubFile,
    pdfMupdfToEpubFile,
    pdfOcrToEpubFile,
    NoTextLayerError,
  } from '@reader/converters';
  import {
    ReaderController,
    type TocEntry,
    type Relocation,
    type EngineMetadata,
    type WordTapInfo,
    type SelectionInfo,
  } from '@reader/reader-engine';
  import { readabilityScore, recordActivity, type Readability } from '@reader/core';
  import { nativeTtsAvailable, nativeSpeak, nativeStop } from '@reader/adapters';
  import { view, settings, readerIsFixedLayout } from '../stores';
  import { toTypography } from '../theme';
  import SettingsPanel from './SettingsPanel.svelte';
  import WordPopover from './WordPopover.svelte';
  import SelectionHelper from './SelectionHelper.svelte';
  import BookmarksPanel from './BookmarksPanel.svelte';
  import HighlightPopover from './HighlightPopover.svelte';
  import QuizPanel from './QuizPanel.svelte';
  import { saveWord } from '../words/store';
  import Icon from './Icon.svelte';

  interface Props {
    bookId: string;
  }
  const { bookId }: Props = $props();

  let container: HTMLElement;
  let controller: ReaderController | null = null;

  let title = $state('');
  let percent = $state(0);
  let toc = $state<TocEntry[]>([]);
  let showToc = $state(false);
  let showSettings = $state(false);

  // Закладки (ТЗ Часть 6, п.6.3)
  let bookmarks = $state<Bookmark[]>([]);
  let showBookmarks = $state(false);
  // Текущая позиция (реактивно, для подсветки кнопки-флажка).
  let currentLocator = $state<string | undefined>(undefined);
  // Текущая позиция уже в закладках? (по точному совпадению locator)
  const currentBookmarked = $derived(
    currentLocator !== undefined && bookmarks.some((b) => b.locator === currentLocator),
  );

  // Выделения/заметки (ТЗ Часть 6, E3)
  let highlights = $state<Highlight[]>([]);
  let activeHighlight = $state<Highlight | null>(null);

  // Квиз по главе (ТЗ Часть 6, E4)
  let quizText = $state<string | null>(null);
  function startQuiz() {
    const t = controller?.sampleText(6000) ?? '';
    if (t.length < 200) {
      alert('Маловато текста на странице для квиза — откройте главу с текстом.');
      return;
    }
    quizText = t;
  }
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Словарь по тапу
  let tapped = $state<WordTapInfo | null>(null);
  let selection = $state<SelectionInfo | null>(null);
  let readability = $state<Readability | null>(null);

  // Линейка чтения: вертикальная позиция курсора (координаты окна).
  let rulerY = $state<number | null>(null);

  // PDF → перетекаемый текст
  let converting = $state(false);
  let convProgress = $state<{ done: number; total: number } | null>(null);
  let convStatus = $state('');

  async function makeTextual(engine: 'pdfjs' | 'mupdf' = 'pdfjs') {
    if (converting) return;
    converting = true;
    convProgress = null;
    convStatus = engine === 'mupdf'
      ? 'Преобразование PDF в текст (mupdf)…'
      : 'Преобразование PDF в текст…';
    try {
      const file = await getBookFile(bookId);
      const toEpub = engine === 'mupdf' ? pdfMupdfToEpubFile : pdfToEpubFile;
      const epub = await toEpub(file, (done, total) => (convProgress = { done, total }));
      const book = await addBook(epub);
      finishConvert(book.id);
    } catch (e) {
      if (e instanceof NoTextLayerError) {
        if (confirm('В PDF нет текста (вероятно, скан). Распознать через OCR? Это может занять время.')) {
          await runOcr();
          return;
        }
      } else {
        alert(e instanceof Error ? e.message : 'Не удалось преобразовать PDF');
      }
      converting = false;
      convProgress = null;
    }
  }

  async function runOcr() {
    convStatus = 'Распознавание текста (OCR)…';
    convProgress = null;
    try {
      const file = await getBookFile(bookId);
      const epub = await pdfOcrToEpubFile(file, (p) => {
        convProgress = { done: p.page, total: p.total };
        if (p.status) convStatus = `OCR: страница ${p.page}/${p.total} — ${p.status}`;
      });
      const book = await addBook(epub);
      finishConvert(book.id);
    } catch (e) {
      converting = false;
      convProgress = null;
      alert(e instanceof Error ? e.message : 'Не удалось распознать PDF');
    }
  }

  function finishConvert(newBookId: string) {
    converting = false;
    convProgress = null;
    view.set({ name: 'reader', bookId: newBookId });
  }

  // Озвучивание (TTS)
  let canSpeak = $state(false);
  let ttsState = $state<'idle' | 'playing' | 'paused'>('idle');
  let ttsRate = $state(1);
  // Нативный системный TTS (в Tauri) — без подсветки слова и листания.
  let nativeAvail = $state(false);
  const useNativeTts = $derived($settings.nativeTts && nativeAvail);

  function ttsStart() {
    if (!controller) return;
    ttsState = 'playing';
    if (useNativeTts) {
      // Системный голос: читаем видимый текст страницы (без подсветки слов).
      const text = controller.sampleText(8000);
      if (!text) {
        ttsState = 'idle';
        return;
      }
      void nativeSpeak(text, ttsRate).catch(() => (ttsState = 'idle'));
      return;
    }
    void controller.speak(
      { rate: ttsRate },
      { onState: (s) => (ttsState = s === 'playing' ? 'playing' : 'idle') },
    );
  }
  function ttsPause() {
    if (useNativeTts) {
      // Нативный TTS без паузы — останавливаем.
      void nativeStop();
      ttsState = 'idle';
      return;
    }
    controller?.pauseSpeech();
    ttsState = 'paused';
  }
  function ttsResume() {
    controller?.resumeSpeech();
    ttsState = 'playing';
  }
  function ttsStop() {
    if (useNativeTts) void nativeStop();
    else controller?.stopSpeech();
    ttsState = 'idle';
  }
  function ttsSetRate(r: number) {
    ttsRate = r;
    // Web Speech не меняет скорость на лету — перезапускаем, если играем.
    if (ttsState === 'playing') {
      ttsStop();
      ttsStart();
    }
  }

  // Метаданные открытой книги и последняя позиция — для синхронизации с сервером.
  let bookMeta: BookMeta | null = null;
  let lastFraction = 0;
  let lastLocator: string | undefined;
  // Живая подписка на прогресс с других устройств + предложение перейти.
  let progressSocket: ProgressSocket | null = null;
  let remoteContinue = $state<RemoteProgress | null>(null);

  function jumpToRemote() {
    if (remoteContinue?.locator) controller?.goTo(remoteContinue.locator);
    remoteContinue = null;
  }

  function onRelocate(loc: Relocation) {
    percent = Math.round(loc.fraction * 100);
    lastFraction = loc.fraction;
    lastLocator = loc.cfi;
    currentLocator = loc.cfi;
    void saveProgress(bookId, loc.fraction, loc.cfi);
    // Синхронизация прогресса с сервером (если книга оттуда; троттлинг внутри).
    if (bookMeta) void pushProgress(bookMeta, loc.fraction, loc.cfi);
  }

  function onMetadata(meta: EngineMetadata) {
    if (meta.title) title = meta.title;
    void updateBook(bookId, {
      title: meta.title || title,
      author: meta.author,
      language: meta.language,
      cover: meta.cover,
    });
  }

  onMount(async () => {
    try {
      const meta = await getBook(bookId);
      if (!meta) {
        // Книга удалена — возвращаемся в библиотеку.
        view.set({ name: 'library' });
        return;
      }
      title = meta.title ?? '';
      bookMeta = meta;
      // Отметить день активности (для серии чтения; показывается, только
      // если геймификация включена в настройках). ТЗ Часть 3 п.6.
      recordActivity();
      const file = await getBookFile(bookId);
      controller = new ReaderController(container, {
        onRelocate,
        onMetadata,
        onWordTap: (info) => (tapped = info),
        onSelection: (info) => (selection = info),
        onPointerY: (y) => (rulerY = y),
        onHighlightClick: (cfi) => void openHighlight(cfi),
      });
      controller.setMath($settings.math);
      // Если на сервере более свежая позиция — открываем с неё («продолжить везде»).
      const remoteLocator = await pullProgress(meta);
      await controller.open(file, remoteLocator ?? meta.locator);
      readerIsFixedLayout.set(controller.isFixedLayout);
      await refreshBookmarks();
      await refreshHighlights();
      // Отрисовать сохранённые выделения в книге.
      await controller.setHighlights(highlights.map((h) => ({ cfi: h.cfi, color: h.color })));
      nativeAvail = await nativeTtsAvailable();
      canSpeak = controller.canSpeak || nativeAvail;
      controller.setTypography(toTypography($settings));
      toc = controller.getToc();
      // Живая синхронизация: другое устройство сдвинуло позицию — предложим перейти.
      progressSocket = subscribeProgress(meta, (p) => (remoteContinue = p));
      // Оценка читаемости по видимому тексту (только перетекаемые книги, не PDF).
      if (!controller.isFixedLayout) {
        const sample = controller.sampleText();
        if (sample.length >= 200) readability = readabilityScore(sample);
      }
    } catch (err) {
      console.error(err);
      error = 'Не удалось открыть книгу. Возможно, формат не поддерживается.';
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    // При закрытии — гарантированно отправляем последнюю позицию на сервер.
    if (bookMeta && lastLocator !== undefined) {
      void pushProgress(bookMeta, lastFraction, lastLocator, true);
    }
    progressSocket?.close();
    controller?.destroy();
    readerIsFixedLayout.set(false);
  });

  // Применяем настройки типографики/темы на лету.
  $effect(() => {
    const s = $settings;
    if (controller) {
      controller.setTypography(toTypography(s));
      controller.setMath(s.math); // применится к следующим открываемым разделам
    }
  });

  function onKey(e: KeyboardEvent) {
    if (showSettings || showToc) return;
    if (e.key === 'ArrowLeft') controller?.goLeft();
    if (e.key === 'ArrowRight') controller?.goRight();
  }

  function goToc(href: string) {
    controller?.goTo(href);
    showToc = false;
  }

  // --- Закладки ---

  async function refreshBookmarks() {
    bookmarks = await listBookmarks(bookId);
  }

  /** Поставить/снять закладку на текущей позиции. */
  async function toggleBookmark() {
    if (currentLocator === undefined) return;
    const existing = bookmarks.find((b) => b.locator === currentLocator);
    if (existing) {
      await removeBookmark(existing.id);
    } else {
      // Короткая цитата с текущей страницы — для опознавания в списке.
      const excerpt = controller?.sampleText(120)?.trim().slice(0, 120) || undefined;
      await addBookmark({
        bookId,
        locator: currentLocator,
        fraction: lastFraction,
        excerpt,
      });
    }
    await refreshBookmarks();
  }

  function goBookmark(locator: string) {
    controller?.goTo(locator);
    showBookmarks = false;
  }

  async function deleteBookmark(id: string) {
    await removeBookmark(id);
    await refreshBookmarks();
  }

  // --- Выделения/заметки ---

  async function refreshHighlights() {
    highlights = await listHighlights(bookId);
  }

  /** Создать выделение из текущего выделения текста. */
  async function highlightSelection() {
    if (!controller || !selection) return;
    const cfi = controller.getSelectionCfi();
    if (!cfi) {
      selection = null;
      return;
    }
    const color = '#ffd54f';
    await saveHighlight({ bookId, cfi, text: selection.text, color, fraction: lastFraction });
    await controller.addHighlight(cfi, color);
    controller.clearSelection();
    selection = null;
    await refreshHighlights();
  }

  /** Клик по подсветке в книге — открыть заметку/удаление. */
  async function openHighlight(cfi: string) {
    const h = await getHighlightByCfi(bookId, cfi);
    if (h) activeHighlight = h;
  }

  /** Открыть выделение из списка по id. */
  async function openHighlightById(id: string) {
    activeHighlight = highlights.find((h) => h.id === id) ?? null;
  }

  async function saveHighlightNote(note: string) {
    if (!activeHighlight) return;
    await setHighlightNote(activeHighlight.id, note);
    activeHighlight = null;
    await refreshHighlights();
  }

  async function deleteHighlight() {
    if (!activeHighlight) return;
    await deleteHighlightDb(activeHighlight.id);
    await controller?.removeHighlight(activeHighlight.cfi);
    activeHighlight = null;
    await refreshHighlights();
  }

  function goHighlight(cfi: string) {
    controller?.goTo(cfi);
    showBookmarks = false;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="reader">
  <header class="bar">
    <button class="icon-btn" onclick={() => view.set({ name: 'library' })} aria-label="К библиотеке">
      <Icon name="back" />
    </button>
    <span class="title" title={title}>{title}</span>
    <span class="spacer"></span>
    {#if readability}
      <span
        class="readability"
        class:easy={readability.label === 'Легко'}
        class:hard={readability.label === 'Сложно'}
        title={`Читаемость: ${readability.label}. ${readability.ageHint}`}
      >
        {readability.label}
      </span>
    {/if}
    <span class="percent">{percent}%</span>

    {#if canSpeak}
      {#if ttsState === 'idle'}
        <button class="icon-btn" onclick={ttsStart} aria-label="Озвучить">
          <Icon name="speaker" />
        </button>
      {:else}
        {#if ttsState === 'playing'}
          <button class="icon-btn" onclick={ttsPause} aria-label="Пауза">
            <Icon name="pause" />
          </button>
        {:else}
          <button class="icon-btn" onclick={ttsResume} aria-label="Продолжить">
            <Icon name="play" />
          </button>
        {/if}
        <button class="icon-btn" onclick={ttsStop} aria-label="Стоп озвучивания">
          <Icon name="stop" />
        </button>
        <select
          class="rate"
          aria-label="Скорость речи"
          value={String(ttsRate)}
          onchange={(e) => ttsSetRate(+e.currentTarget.value)}
        >
          <option value="0.75">0.75×</option>
          <option value="1">1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      {/if}
    {/if}

    {#if $readerIsFixedLayout}
      <button class="text-btn" onclick={() => makeTextual('pdfjs')} disabled={converting} title="Сделать текстовой (перетекаемый шрифт)">
        {converting ? 'Конвертация…' : 'В текст'}
      </button>
      <button class="text-btn" onclick={() => makeTextual('mupdf')} disabled={converting} title="Альтернативный движок mupdf (точнее для сложных PDF)">
        mupdf
      </button>
    {/if}

    <button
      class="icon-btn"
      class:active={currentBookmarked}
      onclick={toggleBookmark}
      disabled={currentLocator === undefined}
      aria-label={currentBookmarked ? 'Убрать закладку' : 'Добавить закладку'}
      title={currentBookmarked ? 'Убрать закладку' : 'Добавить закладку'}
    >
      <Icon name="bookmark" />
    </button>
    <button
      class="icon-btn bm-list"
      onclick={() => (showBookmarks = !showBookmarks)}
      aria-label="Закладки"
      title="Список закладок"
    >
      <Icon name="bookmark" />
      {#if bookmarks.length + highlights.length > 0}<span class="badge">{bookmarks.length + highlights.length}</span>{/if}
    </button>
    {#if !$readerIsFixedLayout}
      <button class="text-btn" onclick={startQuiz} title="Квиз на понимание (ИИ)">
        Квиз
      </button>
    {/if}
    <button class="icon-btn" onclick={() => (showToc = !showToc)} aria-label="Оглавление">
      <Icon name="list" />
    </button>
    <button class="icon-btn" onclick={() => (showSettings = true)} aria-label="Настройки">
      <Icon name="settings" />
    </button>
  </header>

  <div class="stage">
    <button class="nav prev" onclick={() => controller?.goLeft()} aria-label="Назад">
      <Icon name="prev" size={32} />
    </button>
    <div class="surface" bind:this={container}></div>
    <button class="nav next" onclick={() => controller?.goRight()} aria-label="Вперёд">
      <Icon name="next" size={32} />
    </button>

    {#if loading}
      <div class="overlay">Загрузка книги…</div>
    {/if}
    {#if converting}
      <div class="overlay">
        {convStatus}
        {#if convProgress}<br />Страница {convProgress.done} / {convProgress.total}{/if}
      </div>
    {/if}
    {#if error}
      <div class="overlay error">{error}</div>
    {/if}

    {#if remoteContinue}
      <div class="continue-toast" role="status">
        <span>Чтение продолжено на другом устройстве ({Math.round(remoteContinue.fraction * 100)}%).</span>
        <button class="jump" onclick={jumpToRemote} disabled={!remoteContinue.locator}>
          Перейти
        </button>
        <button class="dismiss" onclick={() => (remoteContinue = null)} aria-label="Скрыть">
          <Icon name="close" size={16} />
        </button>
      </div>
    {/if}
  </div>

  {#if showToc}
    <nav class="toc" aria-label="Оглавление">
      <header>
        <h2>Оглавление</h2>
        <button class="icon-btn" onclick={() => (showToc = false)} aria-label="Закрыть">
          <Icon name="close" />
        </button>
      </header>
      {#if toc.length === 0}
        <p class="muted">Оглавление недоступно</p>
      {:else}
        <ul>
          {#each toc as item}
            <li style:padding-left={`${item.level * 0.9 + 0.5}rem`}>
              <button onclick={() => goToc(item.href)}>{item.label}</button>
            </li>
          {/each}
        </ul>
      {/if}
    </nav>
  {/if}

  {#if showBookmarks}
    <BookmarksPanel
      {bookmarks}
      {highlights}
      ongoto={goBookmark}
      onremove={deleteBookmark}
      ongotoHighlight={goHighlight}
      onopenHighlight={openHighlightById}
      onclose={() => (showBookmarks = false)}
    />
  {/if}

  {#if showSettings}
    <SettingsPanel onclose={() => (showSettings = false)} />
  {/if}

  {#if tapped}
    <WordPopover
      word={tapped.word}
      rect={tapped.rect}
      onclose={() => (tapped = null)}
      onsave={(w, def) => saveWord({ word: w, definition: def, bookId })}
    />
  {/if}

  {#if selection}
    <SelectionHelper
      text={selection.text}
      rect={selection.rect}
      onhighlight={highlightSelection}
      onclose={() => (selection = null)}
    />
  {/if}

  {#if activeHighlight}
    <HighlightPopover
      highlight={activeHighlight}
      onsave={saveHighlightNote}
      onremove={deleteHighlight}
      onclose={() => (activeHighlight = null)}
    />
  {/if}

  {#if quizText}
    <QuizPanel text={quizText} onclose={() => (quizText = null)} />
  {/if}

  {#if $settings.readingRuler && rulerY !== null}
    <div class="ruler" style:--ruler-y={`${rulerY}px`}></div>
  {/if}
</div>

<style>
  .reader {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    z-index: 10;
  }
  .title {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 50vw;
  }
  .spacer {
    flex: 1;
  }
  .percent {
    color: var(--muted);
    font-size: 0.85rem;
    min-width: 3ch;
    text-align: right;
  }
  .readability {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--muted);
    font-size: 0.78rem;
    white-space: nowrap;
    cursor: default;
  }
  .readability.easy {
    color: #2e9e5b;
    border-color: #2e9e5b;
  }
  .readability.hard {
    color: #d33;
    border-color: #d33;
  }
  .rate {
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.85rem;
  }
  .text-btn {
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .text-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  /* Линейка чтения: затемняет всё, кроме горизонтальной полосы под курсором. */
  .ruler {
    position: fixed;
    inset: 0;
    z-index: 20;
    pointer-events: none;
  }
  .ruler::before {
    content: '';
    position: fixed;
    left: 0;
    right: 0;
    top: calc(var(--ruler-y) - 1.1em);
    height: 2.2em;
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
  }
  .stage {
    position: relative;
    flex: 1;
    display: flex;
    align-items: stretch;
    min-height: 0;
  }
  .surface {
    flex: 1;
    min-width: 0;
    height: 100%;
  }
  .nav {
    flex: 0 0 auto;
    width: 56px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .nav:hover {
    background: var(--surface);
    color: var(--text);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--muted);
    font-size: 1.05rem;
  }
  .overlay.error {
    color: #d33;
    padding: 2rem;
    text-align: center;
  }
  .toc {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(340px, 92vw);
    background: var(--surface);
    border-right: 1px solid var(--border);
    box-shadow: 8px 0 24px rgba(0, 0, 0, 0.25);
    padding: 1rem 0.6rem 2rem;
    overflow-y: auto;
    z-index: 30;
  }
  .toc header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.4rem 0.6rem;
  }
  .toc h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text);
  }
  .toc ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .toc li button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.5rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 0.92rem;
  }
  .toc li button:hover {
    background: var(--border);
  }
  .muted {
    color: var(--muted);
    padding: 0 0.5rem;
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
  .icon-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* Активная закладка: значок заливается цветом акцента. */
  .icon-btn.active {
    color: var(--accent);
  }
  .icon-btn.active :global(svg) {
    fill: var(--accent);
  }
  .bm-list {
    position: relative;
  }
  .bm-list .badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }
  .continue-toast {
    position: absolute;
    left: 50%;
    bottom: 1.2rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.7rem;
    max-width: 92vw;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
    z-index: 30;
    font-size: 0.9rem;
  }
  .continue-toast .jump {
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.35rem 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .continue-toast .jump:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .continue-toast .dismiss {
    display: flex;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 2px;
  }
</style>
