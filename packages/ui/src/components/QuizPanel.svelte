<script lang="ts">
  /**
   * Квиз на понимание (ТЗ Часть 6, E4): локальная LLM генерит вопросы по
   * тексту главы; ученик отвечает, видит результат и пояснения. Офлайн.
   */
  import { generateQuiz, type QuizQuestion } from '@reader/core';
  import Icon from './Icon.svelte';

  interface Props {
    /** Текст для генерации вопросов (видимая глава/выборка). */
    text: string;
    onclose: () => void;
  }
  const { text, onclose }: Props = $props();

  let loading = $state(true);
  let error = $state('');
  let questions = $state<QuizQuestion[]>([]);
  let answers = $state<number[]>([]);
  let submitted = $state(false);

  const score = $derived(
    submitted ? questions.filter((q, i) => answers[i] === q.correct).length : 0,
  );

  async function run() {
    loading = true;
    error = '';
    submitted = false;
    try {
      questions = await generateQuiz(text, { count: 5 });
      answers = new Array(questions.length).fill(-1);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось составить квиз';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void run();
  });

  function pick(qi: number, oi: number) {
    if (submitted) return;
    answers = answers.map((a, i) => (i === qi ? oi : a));
  }

  const allAnswered = $derived(answers.length > 0 && answers.every((a) => a >= 0));
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<aside class="panel" aria-label="Квиз">
  <header>
    <h2>Проверь себя</h2>
    <button class="icon-btn" onclick={onclose} aria-label="Закрыть"><Icon name="close" /></button>
  </header>

  {#if loading}
    <p class="status">Составляю вопросы…</p>
  {:else if error}
    <p class="status error">{error}</p>
    <button class="ghost" onclick={run}>Повторить</button>
  {:else}
    {#if submitted}
      <p class="score">Результат: {score} из {questions.length}</p>
    {/if}
    <ol class="quiz">
      {#each questions as q, qi (qi)}
        <li>
          <p class="q">{q.q}</p>
          <ul class="opts">
            {#each q.options as opt, oi (oi)}
              <li>
                <button
                  class="opt"
                  class:chosen={answers[qi] === oi}
                  class:correct={submitted && oi === q.correct}
                  class:wrong={submitted && answers[qi] === oi && oi !== q.correct}
                  onclick={() => pick(qi, oi)}
                  disabled={submitted}
                >
                  {opt}
                </button>
              </li>
            {/each}
          </ul>
          {#if submitted && q.explain}
            <p class="explain">💡 {q.explain}</p>
          {/if}
        </li>
      {/each}
    </ol>

    {#if !submitted}
      <button class="primary" onclick={() => (submitted = true)} disabled={!allAnswered}>
        Проверить
      </button>
    {:else}
      <button class="ghost" onclick={run}>Новый квиз</button>
    {/if}
  {/if}
</aside>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
    background: rgba(0, 0, 0, 0.3);
  }
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 96vw);
    background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.25);
    padding: 1rem 0.9rem 2rem;
    overflow-y: auto;
    z-index: 36;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.6rem;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text);
  }
  .status {
    color: var(--muted);
  }
  .status.error {
    color: #c0392b;
  }
  .score {
    font-weight: 700;
    color: var(--text);
    font-size: 1.05rem;
  }
  .quiz {
    list-style: decimal;
    padding-left: 1.2rem;
    margin: 0.5rem 0 1rem;
  }
  .quiz > li {
    margin-bottom: 1rem;
  }
  .q {
    font-weight: 600;
    color: var(--text);
    margin: 0 0 0.4rem;
  }
  .opts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .opt {
    width: 100%;
    text-align: left;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .opt.chosen {
    border-color: var(--accent);
  }
  .opt.correct {
    border-color: #2e9e5b;
    background: rgba(46, 158, 91, 0.12);
  }
  .opt.wrong {
    border-color: #c0392b;
    background: rgba(192, 57, 43, 0.12);
  }
  .opt:disabled {
    cursor: default;
  }
  .explain {
    margin: 0.4rem 0 0;
    font-size: 0.88rem;
    color: var(--muted);
  }
  .primary {
    width: 100%;
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.7rem;
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
    padding: 0.6rem 1rem;
    cursor: pointer;
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
