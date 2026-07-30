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
    log,
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
  import { readabilityScore, recordActivity, recordDiary, type Readability } from '@reader/core';
  import { nativeTtsAvailable, nativeSpeak, nativeStop } from '@reader/adapters';
  import { view, goBack, settings, readerIsFixedLayout } from '../stores';
  import { toTypography } from '../theme';
  import SettingsPanel from './SettingsPanel.svelte';
  import WordPopover from './WordPopover.svelte';
  import SelectionHelper from './SelectionHelper.svelte';
  import BookmarksPanel from './BookmarksPanel.svelte';
  import HighlightPopover from './HighlightPopover.svelte';
  import ClassNotePopover from './ClassNotePopover.svelte';
  import QuizPanel from './QuizPanel.svelte';
  import {
    fetchClassNotes,
    shareToClass,
    removeClassNote,
    canShareToClass,
    CLASS_NOTE_COLOR,
  } from '../server/class-notes';
  import { session } from '../server/auth';
  import type { ClassNote } from '@reader/network';
  import { requestLlm } from './llm-consent';
  import { saveWord } from '../words/store';
  import { t, tr } from '../i18n';
  import Icon from './Icon.svelte';

  interface Props {
    bookId: string;
  }
  const { bookId }: Props = $props();

  let container: HTMLElement;
  let controller: ReaderController | null = null;

  let title = $state('');
  let percent = $state(0);
  // Текущая страница (секция + 1) — для fixed-layout (PDF/CBZ) в шапке
  // показываем «страница/всего» вместо процента.
  let currentPage = $state(0);
  let toc = $state<TocEntry[]>([]);
  let showToc = $state(false);
  let showSettings = $state(false);

  // Переход к странице/проценту (клик по «N%» в шапке).
  let showJump = $state(false);
  let jumpValue = $state('');
  // Число страниц (секций) — для fixed-layout (PDF/CBZ) прыгаем по номеру.
  let totalSections = $state(0);

  function doJump() {
    // bind:value у <input type=number> отдаёт number — приводим к строке.
    const n = Number(String(jumpValue).replace(',', '.'));
    if (!Number.isFinite(n) || !controller) return;
    if ($readerIsFixedLayout && totalSections > 0) {
      const page = Math.min(totalSections, Math.max(1, Math.round(n)));
      controller.goToSection(page - 1);
    } else {
      controller.goToFraction(Math.min(100, Math.max(0, n)) / 100);
    }
    showJump = false;
    jumpValue = '';
  }

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

  // Заметки учителя, видимые классу (по serverId книги).
  let classNotes = $state<ClassNote[]>([]);
  let activeClassNote = $state<ClassNote | null>(null);
  // serverId книги реактивно (bookMeta — обычная переменная, ставится в onMount).
  let serverBookId = $state<string | undefined>(undefined);
  const canShare = $derived(
    canShareToClass($session?.user.role) &&
      $session?.user.status === 'active' &&
      !!serverBookId,
  );

  /** Отрисовать в книге свои выделения + заметки учителя. */
  async function applyHighlights() {
    if (!controller) return;
    await controller.setHighlights([
      ...highlights.map((h) => ({ cfi: h.cfi, color: h.color })),
      ...classNotes.map((n) => ({ cfi: n.cfi, color: n.color ?? CLASS_NOTE_COLOR })),
    ]);
  }

  // Квиз по главе (ТЗ Часть 6, E4)
  let quizText = $state<string | null>(null);
  async function startQuiz() {
    const txt = controller?.sampleText(6000) ?? '';
    if (txt.length < 200) {
      alert(tr('Маловато текста на странице для квиза — откройте главу с текстом.'));
      return;
    }
    if (!(await requestLlm())) return; // бета-ИИ: согласие/выключено
    quizText = txt;
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

  // Масштаб PDF/CBZ поверх вписывания. Запоминается на книгу (meta.zoomPct).
  let zoomPct = $state(100);
  function setZoomPct(pct: number) {
    zoomPct = Math.min(300, Math.max(50, pct));
    controller?.setZoomFactor(zoomPct / 100);
    if (bookMeta) void updateBook(bookId, { zoomPct });
  }
  let convProgress = $state<{ done: number; total: number } | null>(null);
  let convStatus = $state('');

  async function makeTextual(engine: 'pdfjs' | 'mupdf' = 'pdfjs') {
    if (converting) return;
    converting = true;
    convProgress = null;
    convStatus = engine === 'mupdf'
      ? tr('Преобразование PDF в текст (mupdf)…')
      : tr('Преобразование PDF в текст…');
    try {
      const file = await getBookFile(bookId);
      const toEpub = engine === 'mupdf' ? pdfMupdfToEpubFile : pdfToEpubFile;
      const epub = await toEpub(file, (done, total) => (convProgress = { done, total }));
      const book = await addBook(epub);
      finishConvert(book.id);
    } catch (e) {
      if (e instanceof NoTextLayerError) {
        if (confirm(tr('В PDF нет текста (вероятно, скан). Распознать через OCR? Это может занять время.'))) {
          await runOcr();
          return;
        }
      } else {
        alert(e instanceof Error ? e.message : tr('Не удалось преобразовать PDF'));
      }
      converting = false;
      convProgress = null;
    }
  }

  async function runOcr() {
    convStatus = tr('Распознавание текста (OCR)…');
    convProgress = null;
    try {
      const file = await getBookFile(bookId);
      const epub = await pdfOcrToEpubFile(file, (p) => {
        convProgress = { done: p.page, total: p.total };
        if (p.status) convStatus = tr('OCR: страница {0}/{1} — {2}', p.page, p.total, p.status);
      });
      const book = await addBook(epub);
      finishConvert(book.id);
    } catch (e) {
      converting = false;
      convProgress = null;
      alert(e instanceof Error ? e.message : tr('Не удалось распознать PDF'));
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
    if (loc.sectionIndex !== undefined) currentPage = loc.sectionIndex + 1;
    lastFraction = loc.fraction;
    lastLocator = loc.cfi;
    currentLocator = loc.cfi;
    void saveProgress(bookId, loc.fraction, loc.cfi);
    // Читательский дневник: «сегодня читал эту книгу с N% до M%».
    if (bookMeta) recordDiary(bookId, bookMeta.title, loc.fraction);
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
      // Восстановить сохранённый масштаб книги (PDF/CBZ).
      if (controller.isFixedLayout && meta.zoomPct && meta.zoomPct !== 100) {
        zoomPct = Math.min(300, Math.max(50, meta.zoomPct));
        controller.setZoomFactor(zoomPct / 100);
      }
      await refreshBookmarks();
      await refreshHighlights();
      // Заметки учителя (если книга с сервера и есть аккаунт) — тихо при офлайне.
      serverBookId = meta.serverId;
      if (meta.serverId && $session) classNotes = await fetchClassNotes(meta.serverId);
      // Отрисовать сохранённые выделения + заметки учителя в книге.
      await applyHighlights();
      nativeAvail = await nativeTtsAvailable();
      canSpeak = controller.canSpeak || nativeAvail;
      controller.setTypography(toTypography($settings));
      toc = controller.getToc();
      totalSections = controller.sectionCount;
      log.info('reader', 'книга открыта', {
        bookId,
        формат: meta.format,
        фиксированнаяВёрстка: controller.isFixedLayout,
        разделов: totalSections,
        пунктовОглавления: toc.length,
        сСервера: !!meta.serverId,
      });
      // Живая синхронизация: другое устройство сдвинуло позицию — предложим перейти.
      progressSocket = subscribeProgress(meta, (p) => (remoteContinue = p));
      // Оценка читаемости по видимому тексту (только перетекаемые книги, не PDF).
      if (!controller.isFixedLayout) {
        const sample = controller.sampleText();
        if (sample.length >= 200) readability = readabilityScore(sample);
      }
    } catch (err) {
      log.error('reader', 'не удалось открыть книгу', {
        bookId,
        формат: bookMeta?.format,
        название: bookMeta?.title,
        err,
      });
      error = tr('Не удалось открыть книгу. Возможно, формат не поддерживается.');
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
    // CFI, снятый в момент выделения; живое выделение — только как фолбэк
    // (клик по кнопке мог уже снять его в iframe).
    const cfi = selection.cfi ?? controller.getSelectionCfi();
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

  /** Клик по подсветке в книге — своё выделение или заметка учителя. */
  async function openHighlight(cfi: string) {
    const h = await getHighlightByCfi(bookId, cfi);
    if (h) {
      activeHighlight = h;
      return;
    }
    activeClassNote = classNotes.find((n) => n.cfi === cfi) ?? null;
  }

  /** Учитель: показать выделение с заметкой ученикам класса. */
  async function shareHighlight(note: string) {
    if (!activeHighlight || !bookMeta?.serverId) return;
    if (note !== (activeHighlight.note ?? '')) {
      await setHighlightNote(activeHighlight.id, note);
    }
    const err = await shareToClass(bookMeta.serverId, {
      cfi: activeHighlight.cfi,
      text: activeHighlight.text,
      note: note || undefined,
    });
    activeHighlight = null;
    if (err) {
      alert(tr(err));
      return;
    }
    await refreshHighlights();
    classNotes = await fetchClassNotes(bookMeta.serverId);
    await applyHighlights();
  }

  /** Учитель/автор: убрать заметку у класса. */
  async function deleteClassNote() {
    if (!activeClassNote || !bookMeta?.serverId) return;
    const cfi = activeClassNote.cfi;
    await removeClassNote(activeClassNote.id);
    activeClassNote = null;
    classNotes = await fetchClassNotes(bookMeta.serverId);
    // Перерисовать: убрать подсветку, если её больше нет.
    await controller?.removeHighlight(cfi);
    await applyHighlights();
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
    <button class="icon-btn" onclick={goBack} aria-label={$t('Назад')}>
      <Icon name="back" />
    </button>
    <span class="title" title={title}>{title}</span>
    <span class="spacer"></span>
    {#if readability}
      <span
        class="readability"
        class:easy={readability.label === 'Легко'}
        class:hard={readability.label === 'Сложно'}
        title={`${$t('Читаемость')}: ${$t(readability.label)}. ${$t(readability.ageHint)}`}
      >
        {$t(readability.label)}
      </span>
    {/if}
    <button
      class="percent"
      onclick={() => (showJump = !showJump)}
      title={$t('Перейти к странице или проценту')}
      aria-label={$t('Перейти к странице или проценту')}
    >
      {#if $readerIsFixedLayout && currentPage > 0 && totalSections > 0}
        {currentPage}/{totalSections}
      {:else}
        {percent}%
      {/if}
    </button>

    {#if canSpeak}
      {#if ttsState === 'idle'}
        <button class="icon-btn" onclick={ttsStart} aria-label={$t('Озвучить')}>
          <Icon name="speaker" />
        </button>
      {:else}
        {#if ttsState === 'playing'}
          <button class="icon-btn" onclick={ttsPause} aria-label={$t('Пауза')}>
            <Icon name="pause" />
          </button>
        {:else}
          <button class="icon-btn" onclick={ttsResume} aria-label={$t('Продолжить')}>
            <Icon name="play" />
          </button>
        {/if}
        <button class="icon-btn" onclick={ttsStop} aria-label={$t('Стоп озвучивания')}>
          <Icon name="stop" />
        </button>
        <select
          class="rate"
          aria-label={$t('Скорость речи')}
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
      <!-- Неразрывная группа — только зум: «−», «100%» и «+» бессмысленны
           порознь. Кнопки конвертации ниже переносятся сами по себе, иначе
           группа целиком не влезала в строку и уезжала вся. -->
      <div class="pdf-tools">
      <button
        class="text-btn"
        onclick={() => setZoomPct(zoomPct - 25)}
        disabled={zoomPct <= 50}
        title={$t('Уменьшить масштаб')}
        aria-label={$t('Уменьшить масштаб')}
      >
        −
      </button>
      <button
        class="text-btn"
        onclick={() => setZoomPct(100)}
        title={$t('Масштаб; нажмите, чтобы сбросить')}
        aria-label={$t('Масштаб; нажмите, чтобы сбросить')}
      >
        {zoomPct}%
      </button>
      <button
        class="text-btn"
        onclick={() => setZoomPct(zoomPct + 25)}
        disabled={zoomPct >= 300}
        title={$t('Увеличить масштаб')}
        aria-label={$t('Увеличить масштаб')}
      >
        +
      </button>
      </div>
      <button class="text-btn" onclick={() => makeTextual('pdfjs')} disabled={converting} title={$t('Сделать текстовой (перетекаемый шрифт)')}>
        {converting ? $t('Конвертация…') : $t('В текст')}
      </button>
      <button class="text-btn" onclick={() => makeTextual('mupdf')} disabled={converting} title={$t('Альтернативный движок mupdf (точнее для сложных PDF)')}>
        mupdf
      </button>
    {/if}

    <button
      class="icon-btn"
      class:active={currentBookmarked}
      onclick={toggleBookmark}
      disabled={currentLocator === undefined}
      aria-label={currentBookmarked ? $t('Убрать закладку') : $t('Добавить закладку')}
      title={currentBookmarked ? $t('Убрать закладку') : $t('Добавить закладку')}
    >
      <Icon name="bookmark" />
    </button>
    <button
      class="icon-btn bm-list"
      onclick={() => (showBookmarks = !showBookmarks)}
      aria-label={$t('Закладки')}
      title={$t('Список закладок')}
    >
      <Icon name="bookmark" />
      {#if bookmarks.length + highlights.length > 0}<span class="badge">{bookmarks.length + highlights.length}</span>{/if}
    </button>
    {#if !$readerIsFixedLayout && $settings.llmEnabled}
      <button class="text-btn" onclick={startQuiz} title={$t('Квиз на понимание (ИИ, бета)')}>
        {$t('Квиз β')}
      </button>
    {/if}
    <button class="icon-btn" onclick={() => (showToc = !showToc)} aria-label={$t('Оглавление')}>
      <Icon name="list" />
    </button>
    <button class="icon-btn" onclick={() => (showSettings = true)} aria-label={$t('Настройки')}>
      <Icon name="settings" />
    </button>
  </header>

  <div class="stage">
    <button class="nav prev" onclick={() => controller?.goLeft()} aria-label={$t('Назад')}>
      <Icon name="prev" size={32} />
    </button>
    <div class="surface" bind:this={container}></div>
    <button class="nav next" onclick={() => controller?.goRight()} aria-label={$t('Вперёд')}>
      <Icon name="next" size={32} />
    </button>

    {#if showJump}
      <div class="jump-pop" role="dialog" aria-label={$t('Переход по книге')}>
        <label>
          {$readerIsFixedLayout && totalSections > 0
            ? $t('Страница (1–{0})', totalSections)
            : $t('Процент (0–100)')}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="number"
            inputmode="numeric"
            bind:value={jumpValue}
            autofocus
            onkeydown={(e) => e.key === 'Enter' && doJump()}
          />
        </label>
        <button class="go" onclick={doJump}>{$t('Перейти')}</button>
        <button class="cancel" onclick={() => (showJump = false)}>{$t('Отмена')}</button>
      </div>
    {/if}

    {#if loading}
      <div class="overlay">{$t('Загрузка книги…')}</div>
    {/if}
    {#if converting}
      <div class="overlay">
        {convStatus}
        {#if convProgress}<br />{$t('Страница')} {convProgress.done} / {convProgress.total}{/if}
      </div>
    {/if}
    {#if error}
      <div class="overlay error">{error}</div>
    {/if}

    {#if remoteContinue}
      <div class="continue-toast" role="status">
        <span>{$t('Чтение продолжено на другом устройстве ({0}%).', Math.round(remoteContinue.fraction * 100))}</span>
        <button class="jump" onclick={jumpToRemote} disabled={!remoteContinue.locator}>
          {$t('Перейти')}
        </button>
        <button class="dismiss" onclick={() => (remoteContinue = null)} aria-label={$t('Скрыть')}>
          <Icon name="close" size={16} />
        </button>
      </div>
    {/if}
  </div>

  {#if showToc}
    <nav class="toc" aria-label={$t('Оглавление')}>
      <header>
        <h2>{$t('Оглавление')}</h2>
        <button class="icon-btn" onclick={() => (showToc = false)} aria-label={$t('Закрыть')}>
          <Icon name="close" />
        </button>
      </header>
      {#if toc.length === 0}
        <p class="muted">{$t('Оглавление недоступно')}</p>
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
      onshare={canShare ? shareHighlight : undefined}
    />
  {/if}

  {#if activeClassNote}
    <ClassNotePopover
      note={activeClassNote}
      canRemove={canShare &&
        ($session?.user.id === activeClassNote.createdBy ||
          $session?.user.role === 'admin' ||
          $session?.user.role === 'power')}
      onremove={deleteClassNote}
      onclose={() => (activeClassNote = null)}
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
    /* На узком экране (телефон + PDF: счётчик страниц, зум, «В текст», mupdf,
       закладки, оглавление, настройки) в одну строку всё не влезает. Без
       переноса элементы наезжали друг на друга — счётчик уходил под кнопки
       зума. Переносим на вторую строку, а не сжимаем в кашу. */
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    row-gap: 0.35rem;
    padding: 0.4rem 0.6rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    z-index: 10;
  }
  /* Управляющие элементы не ужимаем — иначе подписи режутся и наползают. */
  .bar > button,
  .bar > select,
  .bar > .pdf-tools {
    flex: 0 0 auto;
  }
  .pdf-tools {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .title {
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Ужимается многоточием (min-width: 0 обязателен для flex-элемента),
       но не растягивается: место нужнее кнопкам. */
    flex: 0 1 auto;
    min-width: 0;
    max-width: 50vw;
  }
  /* На телефоне заголовок отдаёт место кнопкам: название книги и так видно
     в библиотеке, а панель из-за него уезжала на лишнюю строку. */
  @media (max-width: 700px) {
    .title {
      max-width: 26vw;
    }
    /* Распорка растягивается на всю свободную ширину и выталкивала кнопки
       на следующую строку, оставляя первую полупустой. На узком экране
       кнопки идут подряд — панель занимает меньше места. */
    .spacer {
      display: none;
    }
  }
  .spacer {
    flex: 1;
  }
  .percent {
    color: var(--muted);
    font-size: 0.85rem;
    min-width: 3ch;
    text-align: right;
    border: none;
    background: transparent;
    padding: 0.25rem 0.3rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .percent:hover {
    color: var(--text);
    background: var(--bg);
  }
  .jump-pop {
    position: absolute;
    top: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: flex-end;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }
  .jump-pop label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    color: var(--muted);
    font-size: 0.82rem;
  }
  .jump-pop input {
    width: 7rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.95rem;
  }
  .jump-pop .go {
    padding: 0.45rem 0.9rem;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .jump-pop .cancel {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
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
