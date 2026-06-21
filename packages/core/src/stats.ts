/**
 * Лёгкая статистика чтения для геймификации (ТЗ Часть 3, п.6).
 * Принцип ТЗ: без давления и пушей, по умолчанию выключено (см. ReaderSettings).
 * Храним лишь множество дней активности (локально), без слежки за временем.
 */

const KEY = 'reader:activityDays';

/** Дата epoch ms → YYYY-MM-DD (локальная). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function save(days: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...days]));
  } catch {
    /* нет localStorage — ок */
  }
}

/** Отметить сегодняшний день как активный (вызывается при открытии книги). */
export function recordActivity(now = new Date()): void {
  const days = load();
  days.add(ymd(now));
  save(days);
}

export interface ReadingStats {
  /** Текущая серия подряд идущих дней чтения. */
  streak: number;
  /** Всего дней с чтением. */
  totalDays: number;
  /** Было ли чтение сегодня. */
  readToday: boolean;
}

/**
 * Подсчитать статистику. Серия считается от сегодня (или вчера, если сегодня
 * ещё не читали) назад по подряд идущим дням.
 */
export function getReadingStats(now = new Date()): ReadingStats {
  const days = load();
  const today = ymd(now);
  const yesterday = ymd(new Date(now.getTime() - 86400000));
  const readToday = days.has(today);

  let streak = 0;
  // Старт серии: сегодня, если читали; иначе вчера (серия ещё «жива» до конца дня).
  const start = readToday ? new Date(now) : days.has(yesterday) ? new Date(now.getTime() - 86400000) : null;
  if (start) {
    const cur = new Date(start);
    while (days.has(ymd(cur))) {
      streak += 1;
      cur.setDate(cur.getDate() - 1);
    }
  }

  return { streak, totalDays: days.size, readToday };
}
