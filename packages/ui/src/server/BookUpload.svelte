<script lang="ts">
  /**
   * Форма добавления книги на сервер (ТЗ Часть 6, п.6.5). Учитель видит только
   * свои классы/предметы; админ/power — всю таксономию. Сервер дублирует проверку.
   */
  import { onMount } from 'svelte';
  import { listSubjects, listClasses, type SubjectEntry, type ClassEntry } from '@reader/core';
  import { session } from './auth';
  import { uploadBook, uploading, uploadError, uploadMsg } from './upload';
  import { t, tr } from '../i18n';

  let file = $state<File | null>(null);
  // Сжатие PDF перед загрузкой (mupdf clean, без потери качества) — ручная
  // опция; форму видят только учитель/power/админ (canUpload в ServerScreen).
  let compressOpt = $state(false);
  let compressing = $state(false);
  let compressNote = $state('');
  const isPdf = $derived(!!file && /\.pdf$/i.test(file.name));
  let title = $state('');
  let pickedClasses = $state<string[]>([]);
  let pickedSubjects = $state<string[]>([]);
  // «Доступна всем» — явный флаг доступа всей школе (ТЗ 6.5).
  let publicAll = $state(false);

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

  // Книга без класса/предмета и без «доступна всем» видна только загрузившему.
  const restricted = $derived(
    !publicAll && pickedClasses.length === 0 && pickedSubjects.length === 0,
  );

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function onPick(e: Event) {
    const inp = e.target as HTMLInputElement;
    file = inp.files?.[0] ?? null;
  }

  async function submit() {
    if (!file || $uploading || compressing) return;
    let payload = file;
    compressNote = '';
    if (compressOpt && isPdf) {
      compressing = true;
      try {
        const { compressPdf } = await import('@reader/converters');
        const r = await compressPdf(file);
        payload = r.file;
        const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
        compressNote = r.compressed
          ? tr('Сжато: {0} МБ → {1} МБ.', mb(r.before), mb(r.after))
          : tr('PDF уже оптимален — сжатие не уменьшило файл.');
      } catch (err) {
        console.error(err);
        compressNote = tr('Сжать не удалось — загружаю исходный файл.');
      } finally {
        compressing = false;
      }
    }
    const ok = await uploadBook(payload, {
      title: title.trim() || undefined,
      classes: pickedClasses,
      subjects: pickedSubjects,
      public: publicAll,
    });
    if (ok) {
      file = null;
      title = '';
      pickedClasses = [];
      pickedSubjects = [];
      publicAll = false;
    }
  }
</script>

<section class="upload">
  <h3>{$t('Добавить книгу')}</h3>
  <input type="file" accept=".epub,.fb2,.pdf,.cbz,.mobi,.azw3" onchange={onPick} />
  <input class="title" type="text" bind:value={title} placeholder={$t('Название (необязательно)')} />

  <div class="group">
    <span class="lbl">{$t('Классы')}</span>
    <div class="chips">
      {#each classOptions as c (c.id)}
        <button
          type="button"
          class="chip"
          class:on={pickedClasses.includes(c.id)}
          onclick={() => (pickedClasses = toggle(pickedClasses, c.id))}
        >
          {$t(c.label)}
        </button>
      {/each}
    </div>
  </div>

  <div class="group">
    <span class="lbl">{$t('Предметы')}</span>
    <div class="chips">
      {#each subjectOptions as s (s.id)}
        <button
          type="button"
          class="chip"
          class:on={pickedSubjects.includes(s.id)}
          onclick={() => (pickedSubjects = toggle(pickedSubjects, s.id))}
        >
          {$t(s.name)}
        </button>
      {/each}
    </div>
  </div>

  <label class="public-toggle">
    <input type="checkbox" bind:checked={publicAll} />
    <span>{$t('Доступна всем (вся школа)')}</span>
  </label>
  {#if isPdf}
    <label class="public-toggle">
      <input type="checkbox" bind:checked={compressOpt} />
      <span>{$t('Сжать PDF перед загрузкой (без потери качества)')}</span>
    </label>
  {/if}
  {#if compressNote}<p class="note">{compressNote}</p>{/if}
  {#if restricted}
    <p class="note">
      {$t(
        'Без класса/предмета и без флага «Доступна всем» книгу увидите только вы и администратор. Назначьте класс/предмет или включите «Доступна всем».',
      )}
    </p>
  {/if}

  {#if $uploadError}<p class="error">{$t($uploadError)}</p>{/if}
  {#if $uploadMsg}<p class="ok">{$uploadMsg}</p>{/if}

  <button class="primary" onclick={submit} disabled={!file || $uploading || compressing}>
    {compressing ? $t('Сжатие PDF…') : $uploading ? $t('Отправка…') : $t('Загрузить на сервер')}
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
  .public-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.2rem 0 0.6rem;
    color: var(--text);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .note {
    margin: 0 0 0.7rem;
    padding: 0.5rem 0.7rem;
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--muted);
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .error {
    color: #c0392b;
  }
  .ok {
    color: #2e9e5b;
  }
</style>
