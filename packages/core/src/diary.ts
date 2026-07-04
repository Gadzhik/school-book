/**
 * Читательский дневник (автособираемый): по дням — какие книги читали и на
 * сколько продвинулись. Заменяет бумажный дневник: экспорт в Markdown, чтобы
 * показать учителю/родителям. Хранение локальное (localStorage), без слежки
 * за временем — только даты и прогресс (в духе ТЗ Часть 3, п.6).
 */

const KEY = 'reader:diary';

/** Запись дня по одной книге. */
export interface DiaryItem {
  bookId: string;
  title: string;
  /** Прогресс в начале дня, %. */
  fromPct: number;
  /** Прогресс в конце дня, %. */
  toPct: number;
}

/** День дневника. */
export interface DiaryDay {
  /** YYYY-MM-DD (локальная дата). */
  date: string;
  items: DiaryItem[];
}

type Stored = Record<string, Record<string, { title: string; from: number; to: number }>>;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function save(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* нет localStorage — ок */
  }
}

/** Хранить не больше года — дневник, не архив. */
const MAX_DAYS = 366;

/**
 * Отметить чтение книги (зовётся при смене позиции). Для дня запоминаются
 * первый и последний прогресс — «с 20% до 34%».
 */
export function recordDiary(bookId: string, title: string, fraction: number, now = new Date()): void {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const s = load();
  const day = ymd(now);
  const d = (s[day] ??= {});
  const item = d[bookId];
  if (item) {
    item.to = pct;
    item.title = title;
  } else {
    d[bookId] = { title, from: pct, to: pct };
  }
  // Обрезка старых дней.
  const dates = Object.keys(s).sort();
  while (dates.length > MAX_DAYS) {
    const oldest = dates.shift();
    if (oldest) delete s[oldest];
  }
  save(s);
}

/** Дневник по дням, свежие сверху. */
export function getDiary(): DiaryDay[] {
  const s = load();
  return Object.keys(s)
    .sort()
    .reverse()
    .map((date) => ({
      date,
      items: Object.entries(s[date]).map(([bookId, v]) => ({
        bookId,
        title: v.title,
        fromPct: v.from,
        toPct: v.to,
      })),
    }));
}

/**
 * Экспорт дневника в Markdown (для учителя/родителей).
 * wordsByDay: дата → сколько новых слов сохранено (необязательно).
 */
export function diaryToMarkdown(
  days: DiaryDay[],
  wordsByDay?: Map<string, number>,
  labels?: { title?: string; words?: string },
): string {
  const lines: string[] = [`# ${labels?.title ?? 'Читательский дневник'}`, ''];
  for (const day of days) {
    lines.push(`## ${day.date}`);
    for (const it of day.items) {
      const range = it.fromPct === it.toPct ? `${it.toPct}%` : `${it.fromPct}% → ${it.toPct}%`;
      lines.push(`- ${it.title} — ${range}`);
    }
    const w = wordsByDay?.get(day.date);
    if (w) lines.push(`- ${labels?.words ?? 'Новые слова'}: ${w}`);
    lines.push('');
  }
  return lines.join('\n');
}
