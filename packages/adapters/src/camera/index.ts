/**
 * Выбор реализации камеры по платформе.
 * Сейчас — только web. Нативные оболочки (Tauri mobile) в Фазе 1 подменят
 * реализацию здесь, не трогая вызывающий код.
 */
import type { CameraAdapter } from './types';
import { webCamera } from './web';

let current: CameraAdapter = webCamera;

/** Получить активный адаптер камеры. */
export function getCamera(): CameraAdapter {
  return current;
}

/** Подменить адаптер камеры (для нативных оболочек). */
export function setCamera(adapter: CameraAdapter): void {
  current = adapter;
}

export * from './types';
export { WebCameraAdapter, webCamera } from './web';
