/**
 * Отправка журнала приложения на школьный сервер.
 *
 * Зачем: журнал лежит в IndexedDB устройства, а разбирать ошибки удобно там,
 * где стоит сервер — особенно для Android, куда иначе не добраться без кабеля.
 * Поэтому клиент периодически досылает накопленные записи, а сервер
 * складывает их в `client-logs/<дата>-<платформа>-<сессия>.ndjson`.
 *
 * Всё мягко: нет сервера, нет сети, сервер старой версии — молча пропускаем,
 * записи остаются в базе и уйдут при следующей удачной попытке. Журнал не
 * должен мешать читать книги.
 */
import { get } from 'svelte/store';
import { takeForUpload, getLogContext, onLog, log } from '@reader/core';
import { takeNativeLog } from '@reader/adapters';
import { connection, currentClient } from './store';

/** Маркер: какой seq журнала уже улетел на сервер. */
const SEQ_KEY = 'reader:logsSeq';
/** Настройка «отправлять журнал на сервер» (по умолчанию включено). */
const SEND_KEY = 'reader:logsSend';
/** Периодичность фоновой отправки. */
const INTERVAL_MS = 60_000;
/** Пауза перед досылкой после ошибки — чтобы собрать «хвост» вокруг неё. */
const ERROR_DEBOUNCE_MS = 3000;
/** Сколько записей отдаём за раз. */
const BATCH = 500;

let sending = false;
let inited = false;
let errorTimer: ReturnType<typeof setTimeout> | null = null;

function readSeq(): number {
  try {
    return Number(localStorage.getItem(SEQ_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeSeq(seq: number): void {
  try {
    localStorage.setItem(SEQ_KEY, String(seq));
  } catch {
    /* нет localStorage — переживём, просто пошлём повторно */
  }
}

/** Включена ли отправка журнала на сервер. */
export function logsUploadEnabled(): boolean {
  try {
    return localStorage.getItem(SEND_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Включить/выключить отправку журнала. */
export function setLogsUploadEnabled(on: boolean): void {
  try {
    localStorage.setItem(SEND_KEY, on ? '1' : '0');
  } catch {
    /* ок */
  }
}

/**
 * Досылка накопленного журнала. `force` — отправить, даже если пользователь
 * отключил автоотправку (кнопка «Отправить сейчас» в настройках).
 * Возвращает число отправленных записей.
 */
export async function flushLogs(force = false): Promise<number> {
  if (sending) return 0;
  if (!force && !logsUploadEnabled()) return 0;
  if (!get(connection)) return 0;
  const client = currentClient();
  if (!client) return 0;

  sending = true;
  let sent = 0;
  try {
    // Несколько пачек за проход: после долгого офлайна журнал может быть большим.
    for (let i = 0; i < 5; i++) {
      const { entries, lastSeq } = await takeForUpload(readSeq(), BATCH);
      if (!entries.length) break;
      await client.uploadLogs(getLogContext(), entries);
      writeSeq(lastSeq);
      sent += entries.length;
      if (entries.length < BATCH) break;
    }
  } catch {
    // Сервер недоступен/старый — записи остаются, попробуем позже.
  } finally {
    sending = false;
  }
  return sent;
}

/**
 * Перенести журнал нативной части оболочки (Tauri) в общий журнал.
 * Там лежат паники Rust и старт оболочки — то, чего веб-слой не видит.
 * В обычном браузере команды нет, вызов ничего не делает.
 */
async function ingestNativeLog(): Promise<void> {
  try {
    const lines = await takeNativeLog();
    if (!lines.length) return;
    for (const l of lines) {
      log[l.level]('native', l.text, l.stamp ? { время: l.stamp } : undefined);
    }
    log.info('native', 'перенесён журнал нативной оболочки', { строк: lines.length });
  } catch {
    /* не Tauri или старая оболочка — не беда */
  }
}

/**
 * Запустить фоновую отправку: по таймеру, при возврате сети, при уходе со
 * страницы и вскоре после каждой ошибки. Повторный вызов безвреден.
 */
export function initLogSync(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;

  void ingestNativeLog();

  setInterval(() => void flushLogs(), INTERVAL_MS);
  window.addEventListener('online', () => void flushLogs());
  window.addEventListener('pagehide', () => void flushLogs());

  // Ошибку стараемся доставить быстро, но с паузой: рядом с ней обычно есть
  // ещё несколько записей, и полезнее прислать их одной пачкой.
  onLog((e) => {
    if (e.level !== 'error' || errorTimer) return;
    errorTimer = setTimeout(() => {
      errorTimer = null;
      void flushLogs();
    }, ERROR_DEBOUNCE_MS);
  });

  log.debug('logs', 'фоновая отправка журнала включена', {
    интервал: INTERVAL_MS,
    отправка: logsUploadEnabled(),
  });
}
