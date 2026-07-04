<script lang="ts">
  /** QR-код из строки (для адреса сервера — ученик сканирует и подключается). */
  import QRCode from 'qrcode';
  import { t } from '../i18n';

  interface Props {
    value: string;
    size?: number;
  }
  const { value, size = 160 }: Props = $props();

  let canvas: HTMLCanvasElement;

  $effect(() => {
    if (!canvas || !value) return;
    void QRCode.toCanvas(canvas, value, { width: size, margin: 1 }).catch(() => {});
  });
</script>

<canvas bind:this={canvas} width={size} height={size} aria-label={$t('QR-код: {0}', value)}></canvas>

<style>
  canvas {
    border-radius: 8px;
    background: #fff;
  }
</style>
