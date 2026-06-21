/**
 * Однократная загрузка foliate-js как статического ESM-модуля.
 * Модуль отдаётся приложением по адресу /foliate-js/view.js и при импорте
 * регистрирует веб-компонент <foliate-view>. Мы используем /* @vite-ignore *\/,
 * чтобы Vite не пытался бандлить foliate-js (он рассчитан на работу из статики).
 */
import { FOLIATE_PUBLIC_BASE } from './constants';

let loaded: Promise<void> | null = null;

/** Гарантировать, что foliate-js загружен и <foliate-view> зарегистрирован. */
export function ensureFoliate(): Promise<void> {
  if (!loaded) {
    const url = `${FOLIATE_PUBLIC_BASE}/view.js`;
    loaded = import(/* @vite-ignore */ url).then(() => {
      if (!customElements.get('foliate-view')) {
        // На случай иной версии view.js без авто-регистрации.
        throw new Error('foliate-view не зарегистрирован после загрузки view.js');
      }
    });
  }
  return loaded;
}

/** Статические draw-функции Overlayer (highlight/underline и т.п.). */
export interface OverlayerClass {
  highlight(rects: DOMRect[], options?: { color?: string }): Element;
  underline(rects: DOMRect[], options?: { color?: string }): Element;
}

let overlayer: Promise<OverlayerClass> | null = null;

/** Лениво загрузить класс Overlayer (для рисования выделений в книге). */
export function loadOverlayer(): Promise<OverlayerClass> {
  if (!overlayer) {
    const url = `${FOLIATE_PUBLIC_BASE}/overlayer.js`;
    overlayer = import(/* @vite-ignore */ url).then(
      (m) => (m as { Overlayer: OverlayerClass }).Overlayer,
    );
  }
  return overlayer;
}
