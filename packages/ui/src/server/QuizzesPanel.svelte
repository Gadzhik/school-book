<script lang="ts">
  /**
   * Квизы от учителя. Учитель/админ/power: создание (вопросы с вариантами),
   * список, результаты класса, удаление. Ученик: список квизов своих классов,
   * прохождение (правильные ответы проверяет сервер), свой балл.
   */
  import { onMount } from 'svelte';
  import { listClasses, type ClassEntry } from '@reader/core';
  import type { Quiz, QuizResultRow, QuizScore } from '@reader/network';
  import { session, authedClient } from './auth';
  import { bookChoices, loadBookChoices, canAssign } from './assignments';
  import { t, tr } from '../i18n';

  const role = $derived($session?.user.role);
  const teacher = $derived(canAssign(role));

  let classes = $state<ClassEntry[]>([]);
  let quizzes = $state<Quiz[]>([]);
  let busy = $state(false);
  let error = $state('');

  const myClasses = $derived(
    role === 'teacher'
      ? classes.filter((c) => ($session?.user.classes ?? []).includes(c.id))
      : classes,
  );
  const classLabel = (id: string) => classes.find((c) => c.id === id)?.label ?? id;

  onMount(async () => {
    classes = await listClasses();
    await load();
    if (teacher) await loadBookChoices();
  });

  async function load() {
    const c = authedClient();
    if (!c) return;
    busy = true;
    error = '';
    try {
      quizzes = await c.listQuizzes();
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось загрузить квизы');
    } finally {
      busy = false;
    }
  }

  // --- Создание (учитель) ---
  interface DraftQ {
    q: string;
    options: string[];
    correct: number;
  }
  let showCreate = $state(false);
  let title = $state('');
  let classId = $state('');
  let bookId = $state('');
  let draft = $state<DraftQ[]>([{ q: '', options: ['', ''], correct: 0 }]);

  function addQuestion() {
    draft = [...draft, { q: '', options: ['', ''], correct: 0 }];
  }
  function removeQuestion(i: number) {
    draft = draft.filter((_, x) => x !== i);
  }
  function addOption(i: number) {
    if (draft[i].options.length >= 6) return;
    draft[i].options = [...draft[i].options, ''];
  }
  function removeOption(i: number, j: number) {
    if (draft[i].options.length <= 2) return;
    draft[i].options = draft[i].options.filter((_, x) => x !== j);
    if (draft[i].correct >= draft[i].options.length) draft[i].correct = 0;
  }

  const draftValid = $derived(
    !!classId &&
      draft.length > 0 &&
      draft.every(
        (d) => d.q.trim() && d.options.length >= 2 && d.options.every((o) => o.trim()),
      ),
  );

  async function create() {
    const c = authedClient();
    if (!c || !draftValid || busy) return;
    busy = true;
    error = '';
    try {
      await c.createQuiz({
        classId,
        bookId: bookId || undefined,
        title: title.trim() || tr('Квиз'),
        questions: draft.map((d) => ({
          q: d.q.trim(),
          options: d.options.map((o) => o.trim()),
          correct: d.correct,
        })),
      });
      showCreate = false;
      title = '';
      bookId = '';
      draft = [{ q: '', options: ['', ''], correct: 0 }];
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось создать квиз');
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
    const c = authedClient();
    if (!c) return;
    if (!confirm(tr('Удалить квиз вместе с результатами учеников?'))) return;
    try {
      await c.deleteQuiz(id);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось удалить');
    }
  }

  // --- Результаты (учитель) ---
  let results = $state<Record<string, QuizResultRow[]>>({});
  let openResults = $state<Record<string, boolean>>({});

  async function toggleResults(id: string) {
    openResults = { ...openResults, [id]: !openResults[id] };
    if (openResults[id] && !results[id]) {
      const c = authedClient();
      if (!c) return;
      try {
        results = { ...results, [id]: await c.quizResults(id) };
      } catch {
        results = { ...results, [id]: [] };
      }
    }
  }

  // --- Прохождение (ученик) ---
  let taking = $state<Quiz | null>(null);
  let answers = $state<number[]>([]);
  let score = $state<QuizScore | null>(null);

  function startTake(q: Quiz) {
    taking = q;
    answers = new Array(q.questions.length).fill(-1);
    score = null;
  }

  const allAnswered = $derived(answers.every((a) => a >= 0));

  async function submit() {
    const c = authedClient();
    if (!c || !taking || !allAnswered || busy) return;
    busy = true;
    error = '';
    try {
      score = await c.submitQuiz(taking.id, answers);
      await load(); // обновить «мой балл» в списке
    } catch (e) {
      error = e instanceof Error ? e.message : tr('Не удалось отправить ответы');
    } finally {
      busy = false;
    }
  }
</script>

<section class="qz">
  <div class="bar">
    <h2>{$t('Квизы')}</h2>
    <button class="ghost sm" onclick={load} disabled={busy}>{$t('Обновить')}</button>
    {#if teacher}
      <button class="primary sm" onclick={() => (showCreate = !showCreate)}>
        {showCreate ? $t('Отмена') : $t('Новый квиз')}
      </button>
    {/if}
  </div>
  {#if error}<p class="error">{$t(error)}</p>{/if}

  {#if teacher && showCreate}
    <div class="create">
      <div class="row">
        <input type="text" bind:value={title} placeholder={$t('Название квиза')} />
        <select bind:value={classId}>
          <option value="" disabled>{$t('Класс…')}</option>
          {#each myClasses as c (c.id)}
            <option value={c.id}>{$t(c.label)}</option>
          {/each}
        </select>
        <select bind:value={bookId}>
          <option value="">{$t('Без книги')}</option>
          {#each $bookChoices as b (b.id)}
            <option value={b.id}>{b.title}</option>
          {/each}
        </select>
      </div>

      {#each draft as d, i (i)}
        <div class="qcard">
          <div class="qhead">
            <span class="qnum">{i + 1}.</span>
            <input type="text" bind:value={d.q} placeholder={$t('Текст вопроса')} />
            <button
              class="ghost sm"
              onclick={() => removeQuestion(i)}
              disabled={draft.length <= 1}
              title={$t('Удалить вопрос')}
            >
              ✕
            </button>
          </div>
          {#each d.options as _, j (j)}
            <label class="opt">
              <input
                type="radio"
                name={`correct-${i}`}
                checked={d.correct === j}
                onchange={() => (d.correct = j)}
                title={$t('Правильный ответ')}
              />
              <input type="text" bind:value={d.options[j]} placeholder={$t('Вариант {0}', j + 1)} />
              <button
                class="ghost sm"
                onclick={() => removeOption(i, j)}
                disabled={d.options.length <= 2}
                title={$t('Удалить вариант')}
              >
                ✕
              </button>
            </label>
          {/each}
          <button class="ghost sm" onclick={() => addOption(i)} disabled={d.options.length >= 6}>
            {$t('+ Вариант')}
          </button>
        </div>
      {/each}

      <div class="row">
        <button class="ghost sm" onclick={addQuestion}>{$t('+ Вопрос')}</button>
        <span class="spacer"></span>
        <span class="hint">{$t('Точка — правильный ответ')}</span>
        <button class="primary sm" onclick={create} disabled={!draftValid || busy}>
          {$t('Создать квиз')}
        </button>
      </div>
    </div>
  {/if}

  {#if quizzes.length === 0 && !busy}
    <p class="muted">{$t('Квизов пока нет.')}</p>
  {:else}
    <ul class="list">
      {#each quizzes as q (q.id)}
        <li>
          <div class="row">
            <span class="q-title">{q.title}</span>
            {#if q.bookTitle}<span class="muted">{q.bookTitle}</span>{/if}
            <span class="tag">{$t(classLabel(q.classId))}</span>
            <span class="muted">{$t('{0} вопр.', q.questions.length)}</span>
            <span class="spacer"></span>
            {#if role === 'student'}
              {#if q.myScore != null}
                <span class="score">{$t('Мой балл: {0}/{1}', q.myScore, q.myTotal)}</span>
                <button class="ghost sm" onclick={() => startTake(q)}>{$t('Пересдать')}</button>
              {:else}
                <button class="primary sm" onclick={() => startTake(q)}>{$t('Пройти')}</button>
              {/if}
            {:else}
              <button class="ghost sm" onclick={() => toggleResults(q.id)}>
                {openResults[q.id] ? $t('Скрыть результаты') : $t('Результаты')}
              </button>
              <button class="ghost sm danger" onclick={() => remove(q.id)}>{$t('Удалить')}</button>
            {/if}
          </div>

          {#if teacher && openResults[q.id]}
            <div class="results">
              {#if !results[q.id]}
                <p class="muted">{$t('Загрузка…')}</p>
              {:else if results[q.id].length === 0}
                <p class="muted">{$t('Никто ещё не проходил.')}</p>
              {:else}
                <ul class="rep">
                  {#each results[q.id] as r (r.userId)}
                    <li>
                      <span>{r.fullName}</span>
                      <span class="score">{r.score}/{r.total}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if taking}
    <div class="backdrop" role="presentation" onclick={() => (taking = null)}></div>
    <div class="take" role="dialog" aria-label={taking.title}>
      <header>
        <h3>{taking.title}</h3>
        <button class="ghost sm" onclick={() => (taking = null)}>✕</button>
      </header>

      {#if score}
        <p class="final">{$t('Результат: {0} из {1}', score.score, score.total)}</p>
      {/if}

      <ol>
        {#each taking.questions as q, i (i)}
          <li>
            <p class="qtext">
              {q.q}
              {#if score}
                <span class={score.per_question[i] ? 'ok' : 'bad'}>
                  {score.per_question[i] ? '✓' : '✗'}
                </span>
              {/if}
            </p>
            {#each q.options as opt, j (j)}
              <label class="opt take-opt">
                <input
                  type="radio"
                  name={`take-${i}`}
                  checked={answers[i] === j}
                  disabled={!!score}
                  onchange={() => (answers[i] = j)}
                />
                <span>{opt}</span>
              </label>
            {/each}
          </li>
        {/each}
      </ol>

      {#if !score}
        <button class="primary" onclick={submit} disabled={!allAnswered || busy}>
          {busy ? $t('Проверка…') : $t('Отправить ответы')}
        </button>
      {:else}
        <button class="primary" onclick={() => (taking = null)}>{$t('Закрыть')}</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .qz {
    margin-top: 1rem;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text);
    flex: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .create {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0.7rem 0;
    padding: 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .create input[type='text'],
  .create select {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .qcard {
    padding: 0.6rem;
    border: 1px dashed var(--border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .qhead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .qhead input {
    flex: 1;
  }
  .qnum {
    color: var(--muted);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .opt input[type='text'] {
    flex: 1;
  }
  .hint {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .list {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .list > li {
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .q-title {
    font-weight: 600;
    color: var(--text);
  }
  .tag {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 0.78rem;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .score {
    font-weight: 700;
    color: var(--accent);
    font-size: 0.9rem;
  }
  .results {
    margin-top: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px dashed var(--border);
  }
  .rep {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rep li {
    display: flex;
    justify-content: space-between;
    padding: 0.2rem 0;
    color: var(--text);
    font-size: 0.9rem;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.35);
  }
  .take {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 41;
    width: min(560px, 94vw);
    max-height: 86vh;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1rem;
  }
  .take header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .take h3 {
    margin: 0;
    color: var(--text);
  }
  .take ol {
    padding-left: 1.2rem;
    color: var(--text);
  }
  .qtext {
    font-weight: 600;
    margin: 0.6rem 0 0.3rem;
  }
  .take-opt {
    margin: 0.15rem 0;
    color: var(--text);
  }
  .ok {
    color: #2e9e5b;
    font-weight: 700;
  }
  .bad {
    color: #c0392b;
    font-weight: 700;
  }
  .final {
    font-weight: 700;
    color: var(--accent);
  }
  .primary {
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.5rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .primary.sm,
  .ghost.sm {
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .ghost.danger {
    color: #c0392b;
  }
  .primary:disabled,
  .ghost:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    color: #c0392b;
  }
</style>
