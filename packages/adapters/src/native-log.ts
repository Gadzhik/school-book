/**
 * Забор нативного журнала оболочки Tauri.
 *
 * Нативная часть (Rust) пишет свой короткий файл `native.log`: старт оболочки
 * и паники, которые в веб-журнал не попадают в принципе. При запуске
 * приложения мы его вычитываем командой `native_log_take` (она же очищает
 * файл) и складываем строки в общий журнал — дальше их подхватит обычная
 * отправка на школьный сервер.
 *
 * Вне Tauri (обычный браузер) команды нет — тихо ничего не делаем.
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__TAURI__?.core?.invoke ?? null;
}

/** Строка нативного журнала: `2026-07-30 15:31:02Z [error] ПАНИКА …`. */
export interface NativeLogLine {
  stamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  text: string;
}

/**
 * Прочитать и очистить нативный журнал. Пустой массив — не Tauri, команды нет
 * (старая сборка оболочки) или журнал пуст.
 */
export async function takeNativeLog(): Promise<NativeLogLine[]> {
  const inv = tauriInvoke();
  if (!inv) return [];
  let raw = '';
  try {
    raw = await inv<string>('native_log_take');
  } catch {
    // Оболочка без этой команды — не считаем ошибкой.
    return [];
  }
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(\S+ \S+)\s+\[(\w+)\]\s+([\s\S]*)$/.exec(line);
      if (!m) return { stamp: '', level: 'info' as const, text: line };
      const lvl = m[2].toLowerCase();
      return {
        stamp: m[1],
        level: (['debug', 'info', 'warn', 'error'].includes(lvl)
          ? lvl
          : 'info') as NativeLogLine['level'],
        text: m[3],
      };
    });
}
