<script lang="ts">
  /** Простой набор иконок (inline SVG). Понятные крупные значки для детей. */
  interface Props {
    name:
      | 'book'
      | 'plus'
      | 'settings'
      | 'back'
      | 'prev'
      | 'next'
      | 'list'
      | 'trash'
      | 'close'
      | 'speaker'
      | 'play'
      | 'pause'
      | 'stop'
      | 'bookmark';
    size?: number;
  }
  const { name, size = 24 }: Props = $props();

  const paths: Record<Props['name'], string> = {
    book: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM6 3v16',
    plus: 'M12 5v14M5 12h14',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
    back: 'M15 18l-6-6 6-6',
    prev: 'M15 18l-6-6 6-6',
    next: 'M9 6l6 6-6 6',
    list: 'M4 6h16M4 12h16M4 18h16',
    trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
    close: 'M6 6l12 12M18 6L6 18',
    speaker: 'M4 9v6h4l5 4V5L8 9zM16 9a3 3 0 0 1 0 6M18.5 7a6 6 0 0 1 0 10',
    play: 'M8 5l11 7-11 7z',
    pause: 'M8 5v14M16 5v14',
    stop: 'M6 6h12v12H6z',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
