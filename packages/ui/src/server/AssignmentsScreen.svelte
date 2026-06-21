<script lang="ts">
  /**
   * Задания (ТЗ Часть 6, п.6.5). Ученик видит свои задания и отмечает
   * выполнение; учитель/админ создаёт задания и смотрит отчёт по классу.
   */
  import { onMount } from 'svelte';
  import { listClasses, type ClassEntry } from '@reader/core';
  import { session } from './auth';
  import {
    assignments,
    assignmentsBusy,
    assignmentsError,
    bookChoices,
    reports,
    canAssign,
    isStudentView,
    loadAssignments,
    loadBookChoices,
    createAssignment,
    deleteAssignment,
    markProgress,
    loadReport,
  } from './assignments';

  const role = $derived($session?.user.role);
  const teacher = $derived(canAssign(role));

  let classes = $state<ClassEntry[]>([]);
  const classLabel = (id: string) => classes.find((c) => c.id === id)?.label ?? `класс ${id}`;
  // Учителю — только свои классы для создания задания.
  const myClasses = $derived(
    role === 'teacher' ? classes.filter((c) => ($session?.user.classes ?? []).includes(c.id)) : classes,
  );

  // Форма создания
  let bookId = $state('');
  let classId = $state('');
  let title = $state('');
  let due = $state(''); // yyyy-mm-dd

  // Какие отчёты раскрыты
  let openReport = $state<Record<string, boolean>>({});

  const STATUS_LABEL: Record<string, string> = {
    not_started: 'не начато',
    reading: 'читает',
    done: 'прочитано',
  };

  onMount(async () => {
    classes = await listClasses();
    await loadAssignments();
    if (teacher) await loadBookChoices();
  });

  async function submit() {
    if (!bookId || !classId || $assignmentsBusy) return;
    const dueAt = due ? new Date(due).getTime() : undefined;
    const ok = await createAssignment({ bookId, classId, title: title.trim() || undefined, dueAt });
    if (ok) {
      bookId = '';
      classId = '';
      title = '';
      due = '';
    }
  }

  async function toggleReport(id: string) {
    openReport = { ...openReport, [id]: !openReport[id] };
    if (openReport[id] && !$reports[id]) await loadReport(id);
  }

  function fmtDue(ms?: number): string {
    if (!ms) return '';
    return `до ${new Date(ms).toLocaleDateString('ru-RU')}`;
  }
</script>

<section class="asg">
  <div class="bar">
    <h2>Задания</h2>
    <button class="ghost sm" onclick={loadAssignments} disabled={$assignmentsBusy}>Обновить</button>
  </div>
  {#if $assignmentsError}<p class="error">{$assignmentsError}</p>{/if}

  {#if teacher}
    <div class="create">
      <h3>Новое задание</h3>
      <select bind:value={bookId}>
        <option value="" disabled>Книга…</option>
        {#each $bookChoices as b (b.id)}
          <option value={b.id}>{b.title}</option>
        {/each}
      </select>
      <select bind:value={classId}>
        <option value="" disabled>Класс…</option>
        {#each myClasses as c (c.id)}
          <option value={c.id}>{c.label}</option>
        {/each}
      </select>
      <input type="text" bind:value={title} placeholder="Название (необязательно)" />
      <input type="date" bind:value={due} title="Срок (необязательно)" />
      <button class="primary sm" onclick={submit} disabled={!bookId || !classId || $assignmentsBusy}>
        Назначить
      </button>
    </div>
  {/if}

  {#if $assignments.length === 0}
    <p class="muted">Заданий пока нет.</p>
  {:else}
    <ul>
      {#each $assignments as a (a.id)}
        <li>
          <div class="row">
            <span class="a-title">{a.title}</span>
            <span class="muted">{a.bookTitle} · {classLabel(a.classId)}</span>
            {#if a.dueAt}<span class="due">{fmtDue(a.dueAt)}</span>{/if}
            <span class="spacer"></span>

            {#if isStudentView(a)}
              <span class="status s-{a.status}">{STATUS_LABEL[a.status] ?? a.status}</span>
              {#if a.status !== 'done'}
                <button class="primary sm" onclick={() => markProgress(a.id, 'done')}>
                  Отметить прочитанным
                </button>
              {/if}
            {:else if teacher}
              <button class="ghost sm" onclick={() => toggleReport(a.id)}>
                {openReport[a.id] ? 'Скрыть отчёт' : 'Отчёт'}
              </button>
              <button class="ghost sm danger" onclick={() => deleteAssignment(a.id)}>Удалить</button>
            {/if}
          </div>

          {#if teacher && openReport[a.id]}
            <div class="report">
              {#if !$reports[a.id]}
                <p class="muted">Загрузка…</p>
              {:else if $reports[a.id].length === 0}
                <p class="muted">В классе нет учеников.</p>
              {:else}
                {@const rows = $reports[a.id]}
                {@const done = rows.filter((r) => r.status === 'done').length}
                <p class="muted">Прочитали: {done} из {rows.length}</p>
                <ul class="rep">
                  {#each rows as r (r.userId)}
                    <li>
                      <span>{r.fullName}</span>
                      <span class="status s-{r.status}">{STATUS_LABEL[r.status] ?? r.status}</span>
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
</section>

<style>
  .asg {
    margin-top: 1rem;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text);
  }
  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.95rem;
    color: var(--text);
  }
  .create {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.8rem;
    margin: 0.6rem 0 1rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .create h3 {
    flex-basis: 100%;
  }
  .create select,
  .create input {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  li {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    padding: 0.6rem 0.8rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .a-title {
    font-weight: 600;
    color: var(--text);
  }
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .due {
    font-size: 0.8rem;
    color: #b58600;
  }
  .spacer {
    flex: 1;
  }
  .status {
    font-size: 0.8rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .status.s-done {
    color: #2e9e5b;
    border-color: #2e9e5b;
  }
  .status.s-reading {
    color: #b58600;
    border-color: #d9a400;
  }
  .report {
    margin-top: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px dashed var(--border);
  }
  .rep {
    gap: 0.2rem;
  }
  .rep li {
    display: flex;
    justify-content: space-between;
    border: none;
    background: transparent;
    padding: 0.25rem 0;
  }
  .primary {
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
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
