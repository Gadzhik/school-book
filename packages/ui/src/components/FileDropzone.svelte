<script lang="ts">
  import { addFiles } from '../stores';
  import Icon from './Icon.svelte';

  let dragging = $state(false);
  let input: HTMLInputElement;

  const ACCEPT =
    '.epub,.fb2,.fb2.zip,.fbz,.zip,.mobi,.azw3,.kf8,.pdf,.cbz,.cbr';

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files?.length) await addFiles(e.dataTransfer.files);
  }

  async function onPick(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files?.length) await addFiles(target.files);
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
</style>
