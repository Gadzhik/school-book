/**
 * Живая синхронизация прогресса через WebSocket (ТЗ 4.4, 4.9.4):
 * «продолжить на любом устройстве» в реальном времени. Сервер рассылает
 * обновления прогресса, клиент подписывается. Опционально и graceful.
 */
import type { ServerInfo, DeviceProgress } from './types';

/** Управление открытым сокетом. */
export interface ProgressSocket {
  close(): void;
}

export interface ProgressSocketOptions {
  /** Токен пэйринга (передаётся в query — браузер не шлёт заголовки для WS). */
  token?: string;
  /** Колбэк на каждое обновление прогресса. */
  onProgress: (p: DeviceProgress) => void;
  /** Колбэк на ошибку/закрытие (для возможного переподключения в UI). */
  onClose?: () => void;
}

/** http(s)://host → ws(s)://host. */
function toWsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws');
}

/**
 * Открыть сокет живой синхронизации прогресса. Возвращает объект с close().
 * Сетевые ошибки не бросает — при сбое просто не приходят сообщения.
 */
export function openProgressSocket(
  server: ServerInfo,
  opts: ProgressSocketOptions,
): ProgressSocket {
  let url = `${toWsUrl(server.baseUrl)}/ws`;
  if (opts.token) url += `?token=${encodeURIComponent(opts.token)}`;

  let ws: WebSocket | null = null;
  let closed = false;
  try {
    ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        opts.onProgress(JSON.parse(ev.data as string) as DeviceProgress);
      } catch {
        /* мусорное сообщение — пропускаем */
      }
    };
    ws.onclose = () => {
      if (!closed) opts.onClose?.();
    };
    ws.onerror = () => {
      if (!closed) opts.onClose?.();
    };
  } catch {
    opts.onClose?.();
  }

  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
