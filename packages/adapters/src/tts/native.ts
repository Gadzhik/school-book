/**
 * Адаптер нативного синтеза речи (Фаза 1). В оболочке Tauri (десктоп/мобилка)
 * вызывает нативные команды `tts_speak/tts_stop/tts_available` — системные
 * голоса (часто лучше, чем Web Speech, особенно в Android WebView без голосов).
 * Вне Tauri или при ошибке — недоступен, UI остаётся на Web Speech.
 */

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Глобальный invoke Tauri (есть только в нативной оболочке). */
function tauriInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__TAURI__?.core?.invoke ?? null;
}

/** Доступен ли нативный TTS (есть Tauri и платформенный бэкенд). */
export async function nativeTtsAvailable(): Promise<boolean> {
  const inv = tauriInvoke();
  if (!inv) return false;
  try {
    return await inv<boolean>('tts_available');
  } catch {
    return false;
  }
}

/** Произнести текст системным голосом. rate 0..1 (как у Web Speech). */
export async function nativeSpeak(text: string, rate?: number): Promise<void> {
  const inv = tauriInvoke();
  if (!inv) throw new Error('Нативный TTS доступен только в приложении');
  await inv('tts_speak', { text, rate });
}

/** Остановить нативное озвучивание. */
export async function nativeStop(): Promise<void> {
  const inv = tauriInvoke();
  if (inv) {
    try {
      await inv('tts_stop');
    } catch {
      /* уже остановлено — ок */
    }
  }
}
