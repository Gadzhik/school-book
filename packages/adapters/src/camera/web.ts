/**
 * Web-реализация камеры через <input type="file" accept="image/*" capture>.
 * Это самый надёжный путь на вебе: на мобильных браузерах атрибут capture
 * открывает родной интерфейс камеры, на десктопе — выбор файлов.
 * (Поток getUserMedia с предпросмотром можно добавить позже отдельной реализацией.)
 */
import type { CameraAdapter, CaptureOptions } from './types';

export class WebCameraAdapter implements CameraAdapter {
  isAvailable(): boolean {
    return typeof document !== 'undefined';
  }

  capture(options: CaptureOptions = {}): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (options.multiple) input.multiple = true;
      // capture="environment" подсказывает браузеру открыть тыловую камеру.
      if (options.facing) input.capture = options.facing;
      input.style.position = 'fixed';
      input.style.left = '-9999px';

      let settled = false;
      const done = (files: File[]) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(files);
      };

      input.addEventListener('change', () => {
        const files = input.files ? Array.from(input.files) : [];
        done(files.filter((f) => f.type.startsWith('image/')));
      });
      // Если диалог закрыт без выбора — событие change может не прийти;
      // отмену обрабатываем по возврату фокуса на окно.
      window.addEventListener(
        'focus',
        () => setTimeout(() => done([]), 500),
        { once: true },
      );

      document.body.append(input);
      input.click();
    });
  }
}

/** Готовый экземпляр web-адаптера. */
export const webCamera = new WebCameraAdapter();
