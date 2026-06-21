/**
 * Обнаружение/пэйринг сервера для веб-клиента (ТЗ 4.3).
 * Браузер не умеет raw mDNS, поэтому: QR-пэйринг и ручной ввод адреса.
 * (mDNS-поиск — в нативных клиентах Tauri, отдельным модулем.)
 */
import { DEFAULT_PORT, type PairingInfo } from './types';

/**
 * Привести ручной ввод к baseUrl.
 * Принимает '192.168.1.10', '192.168.1.10:9700', 'http://host:port', 'host/path'.
 * По умолчанию схема http и порт 9700 (изолированная LAN, ТЗ 4.5).
 */
export function normalizeManualAddress(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('Пустой адрес');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  if (!u.port) u.port = String(DEFAULT_PORT);
  // Убираем хвостовой слэш для консистентного baseUrl.
  return u.toString().replace(/\/$/, '');
}

/**
 * Разобрать payload QR-кода пэйринга. Поддерживаем:
 *  - 'chitalka://pair?addr=192.168.1.10&port=9700&token=ABC'
 *  - 'http://192.168.1.10:9700?token=ABC'
 *  - 'http://192.168.1.10:9700' или '192.168.1.10:9700'
 */
export function parsePairingPayload(payload: string): PairingInfo {
  const s = payload.trim();

  if (/^chitalka:\/\//i.test(s)) {
    // Кастомная схема — парсим вручную (URL не всегда разбирает кастомные схемы консистентно).
    const q = s.split('?')[1] ?? '';
    const params = new URLSearchParams(q);
    const addr = params.get('addr') ?? '';
    const port = params.get('port') ?? String(DEFAULT_PORT);
    if (!addr) throw new Error('QR: нет адреса сервера');
    return {
      baseUrl: normalizeManualAddress(`${addr}:${port}`),
      token: params.get('token') ?? undefined,
    };
  }

  // Обычный URL или host:port с опциональным ?token=.
  const baseUrl = normalizeManualAddress(s);
  let token: string | undefined;
  try {
    token = new URL(baseUrl).searchParams.get('token') ?? undefined;
  } catch {
    /* ок */
  }
  // baseUrl без query.
  const clean = baseUrl.replace(/\?.*$/, '');
  return { baseUrl: clean, token };
}
