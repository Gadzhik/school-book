<script lang="ts">
  import { get } from 'svelte/store';
  import { addFiles } from '../stores';
  import { session, authedClient } from '../server/auth';
  import { canUpload, publishToServer, uploadError } from '../server/upload';
  import Icon from './Icon.svelte';

  let dragging = $state(false);
  let status = $state('');
  let input: HTMLInputElement;

  const ACCEPT =
    '.epub,.fb2,.fb2.zip,.fbz,.zip,.mobi,.azw3,.kf8,.pdf,.cbz,.cbr';

  /**
   * Добавление книги. Всегда импортируем локально (получаем авторазметку тегов
   * и локальную копию для чтения). Если пользователь вошёл на сервер и имеет
   * права (учитель/старший/админ) — сразу публикуем книгу на сервер с её
   * тегами, чтобы ученики класса её увидели. Позже теги можно поправить и
   * нажать «На сервер» на карточке (теги доедут без повторной загрузки).
   */
  async function handleFiles(files: FileList) {
    status = '';
    const role = get(session)?.user.role;
    const added = await addFiles(files);
    if (authedClient() && canUpload(role) && added.length) {
      status = 'Публикация на сервере…';
      let ok = 0;
      for (const b of added) if (await publishToServer(b)) ok++;
      status =
        ok === added.length
          ? `Добавлено и опубликовано на сервере: ${ok}`
          : `Опубликовано ${ok} из ${added.length}. ${get(uploadError) || ''}`.trim();
    } else if (added.length) {
      status = `Добавлено: ${added.length}`;
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files);
  }

  async function onPick(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files?.length) await handleFiles(target.files);
    target.value = '';
  }
</script>

<div
  class="dropzone"
  class:dragging
  role="button"
  tabindex="0"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
  onclick={() => input.click()}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input.click()}
>
  <Icon name="plus" size={40} />
  <p class="title">Добавить книгу</p>
  <p class="hint">Перетащите файл сюда или нажмите, чтобы выбрать</p>
  <p class="formats">EPUB · FB2 · FB2.zip · PDF · MOBI · CBZ</p>
  {#if status}<p class="status">{status}</p>{/if}
  <input
    bind:this={input}
    type="file"
    accept={ACCEPT}
    multiple
    onchange={onPick}
    hidden
  />
</div>

<style>
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 2rem;
    border: 2px dashed var(--border);
    border-radius: 16px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s, background 0.15s;
  }
  .dropzone:hover,
  .dropzone:focus-visible,
  .dragging {
    border-color: var(--accent);
    color: var(--text);
    outline: none;
  }
  .title {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
    margin: 0.3rem 0 0;
  }
  .hint {
    margin: 0;
    font-size: 0.95rem;
  }
  .formats {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    opacity: 0.8;
  }
  .status {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: var(--accent);
  }
</style>
