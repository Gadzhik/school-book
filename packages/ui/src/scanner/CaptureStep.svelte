<script lang="ts">
  import { capturePages, importFiles, scannerBusy, autoCrop } from './store';
  import Icon from '../components/Icon.svelte';

  let input: HTMLInputElement;
  let dragging = $state(false);

  async function onPick(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.files?.length) await importFiles(Array.from(t.files));
    t.value = '';
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files?.length) await importFiles(Array.from(e.dataTransfer.files));
  }
</script>

<div
  class="capture"
  class:dragging
  role="group"
  aria-label="Добавление страниц"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <button class="big" disabled={$scannerBusy} onclick={() => capturePages()}>
    <Icon name="plus" size={28} />
    <span>Снять камерой</span>
  </button>
  <button class="big secondary" disabled={$scannerBusy} onclick={() => input.click()}>
    <Icon name="book" size={28} />
    <span>Загрузить фото</span>
  </button>
  <label class="opt">
    <input type="checkbox" bind:checked={$autoCrop} disabled={$scannerBusy} />
    <span>Авто-обрезка по краям листа</span>
  </label>
  <p class="hint">Снимайте страницы по одной или перетащите готовые фото сюда</p>
  <input
    bind:this={input}
    type="file"
    accept="image/*"
    multiple
    hidden
    onchange={onPick}
  />
</div>

<style>
  .capture {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border: 2px dashed var(--border);
    border-radius: 14px;
    background: var(--surface);
  }
  .capture.dragging {
    border-color: var(--accent);
  }
  .big {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 1.1rem;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .big.secondary {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
  }
  .big:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .opt {
    flex-basis: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text);
    font-size: 0.95rem;
    cursor: pointer;
  }
  .opt input {
    width: 1.1rem;
    height: 1.1rem;
  }
  .hint {
    flex-basis: 100%;
    margin: 0.2rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
