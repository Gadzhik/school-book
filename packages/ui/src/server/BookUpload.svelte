<script lang="ts">
  /**
   * Форма добавления книги на сервер (ТЗ Часть 6, п.6.5). Учитель видит только
   * свои классы/предметы; админ/power — всю таксономию. Сервер дублирует проверку.
   */
  import { onMount } from 'svelte';
  import { listSubjects, listClasses, type SubjectEntry, type ClassEntry } from '@reader/core';
  import { session } from './auth';
  import { uploadBook, uploading, uploadError, uploadMsg } from './upload';

  let file = $state<File | null>(null);
  let title = $state('');
  let pickedClasses = $state<string[]>([]);
  let pickedSubjects = $state<string[]>([]);

  let subjects = $state<SubjectEntry[]>([]);
  let classes = $state<ClassEntry[]>([]);

  const role = $derived($session?.user.role);
  const ownClasses = $derived($session?.user.classes ?? []);
  const ownSubjects = $derived($session?.user.subjects ?? []);
  // Учитель ограничен своими классами/предметами; админ/power — всё.
  const classOptions = $derived(
    role === 'teacher' ? classes.filter((c) => ownClasses.includes(c.id)) : classes,
  );
  const subjectOptions = $derived(
    role === 'teacher' ? subjects.filter((s) => ownSubjects.includes(s.id)) : subjects,
  );

  onMount(async () => {
    subjects = await listSubjects();
    classes = await listClasses();
  });

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function onPick(e: Event) {
    const t = e.target as HTMLInputElement;
    file = t.files?.[0] ?? null;
  }

  async function submit() {
    if (!file || $uploading) return;
    const ok = await uploadBook(file, {
      title: title.trim() || undefined,
      classes: pickedClasses,
      subjects: pickedSubjects,
    });
    if (ok) {
      file = null;
      title = '';
      pickedClasses = [];
      pickedSubjects = [];
    }
  }
</script>

<section class="upload">
  <h3>Добавить книгу</h3>
  <input type="file" accept=".epub,.fb2,.pdf,.cbz,.mobi,.azw3" onchange={onPick} />
  <input class="title" type="text" bind:value={title} placeholder="Название (необязательно)" />

  <div class="group">
    <span class="lbl">Классы</span>
    <div class="chips">
      {#each classOptions as c (c.id)}
        <button
          type="button"
          class="chip"
          class:on={pickedClasses.includes(c.id)}
          onclick={() => (pickedClasses = toggle(pickedClasses, c.id))}
        >
          {c.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="group">
    <span class="lbl">Предметы</span>
    <div class="chips">
      {#each subjectOptions as s (s.id)}
        <button
          type="button"
          class="chip"
          class:on={pickedSubjects.includes(s.id)}
          onclick={() => (pickedSubjects = toggle(pickedSubjects, s.id))}
        >
          {s.name}
        </button>
      {/each}
    </div>
  </div>

  {#if $uploadError}<p class="error">{$uploadError}</p>{/if}
  {#if $uploadMsg}<p class="ok">{$uploadMsg}</p>{/if}

  <button class="primary" onclick={submit} disabled={!file || $uploading}>
    {$uploading ? 'Загрузка…' : 'Загрузить на сервер'}
  </button>
</section>

<style>
  .upload {
    margin-top: 1rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  h3 {
    margin: 0 0 0.7rem;
    font-size: 1rem;
    color: var(--text);
  }
  input[type='file'] {
    display: block;
    margin-bottom: 0.6rem;
    color: var(--text);
  }
  .title {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.7rem;
    margin-bottom: 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
  }
  .group {
    margin-bottom: 0.7rem;
  }
  .lbl {
    display: block;
    font-size: 0.8rem;
    color: var(--muted);
    margin-bottom: 0.3rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    padding: 0.3rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .chip.on {
    background: var(--accent);
    color: var(--on-accent);
    border-color: var(--accent);
  }
  .primary {
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.6rem 1rem;
    font-weight: 700;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .error {
    color: #c0392b;
  }
  .ok {
    color: #2e9e5b;
  }
</style>
