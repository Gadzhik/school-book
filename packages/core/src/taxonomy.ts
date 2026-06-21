/**
 * Управляемые словари классификации (ТЗ Часть 5, раздел 5.3).
 * Классы (1–11) фиксированы, предметы и категории — редактируемые списки.
 * При первом запуске стора сидируются дефолтным ФГОС-набором.
 *
 * Класс и предмет — это ТЕГИ, не папки: книга может иметь 0..N классов
 * и 0..N предметов (фасетная фильтрация, не дерево каталогов).
 */
import { getDB } from './storage/db';
import type {
  CategoryEntry,
  SubjectEntry,
  ClassEntry,
  ClassGroup,
} from './types';

/** Группа класса по номеру (младшая 1–4, средняя 5–9, старшая 10–11). */
function groupOf(n: number): ClassGroup {
  if (n <= 4) return 'junior';
  if (n <= 9) return 'middle';
  return 'senior';
}

/** Подпись группы классов. */
export const CLASS_GROUP_LABELS: Record<ClassGroup, string> = {
  junior: 'Младшая школа (1–4)',
  middle: 'Средняя школа (5–9)',
  senior: 'Старшая школа (10–11)',
};

/** Классы 1–11 с группировкой. */
export const DEFAULT_CLASSES: ClassEntry[] = Array.from({ length: 11 }, (_, i) => {
  const number = i + 1;
  return {
    id: String(number),
    label: `${number} класс`,
    number,
    group: groupOf(number),
  };
});

/** Категории (тип материала) — ТЗ 5.1. */
export const DEFAULT_CATEGORIES: CategoryEntry[] = [
  { id: 'textbook', name: 'Учебник' },
  { id: 'manual', name: 'Пособие' },
  { id: 'workbook', name: 'Рабочая тетрадь' },
  { id: 'reader', name: 'Хрестоматия' },
  { id: 'fiction', name: 'Художественная' },
  { id: 'popsci', name: 'Научпоп' },
  { id: 'reference', name: 'Справочник/словарь' },
  { id: 'atlas', name: 'Атлас' },
  { id: 'comic', name: 'Комикс' },
  { id: 'extracurricular', name: 'Внеклассное чтение' },
];

/** Предметы по ФГОС (базовый расширяемый набор) — ТЗ 5.3. */
export const DEFAULT_SUBJECTS: SubjectEntry[] = [
  { id: 'russian', name: 'Русский язык' },
  { id: 'literature', name: 'Литература (Литературное чтение)' },
  { id: 'math', name: 'Математика' },
  { id: 'algebra', name: 'Алгебра' },
  { id: 'geometry', name: 'Геометрия' },
  { id: 'informatics', name: 'Информатика' },
  { id: 'physics', name: 'Физика' },
  { id: 'chemistry', name: 'Химия' },
  { id: 'biology', name: 'Биология' },
  { id: 'geography', name: 'География' },
  { id: 'history', name: 'История' },
  { id: 'social', name: 'Обществознание' },
  { id: 'foreign', name: 'Иностранный язык' },
  { id: 'world', name: 'Окружающий мир' },
  { id: 'astronomy', name: 'Астрономия' },
  { id: 'art', name: 'ИЗО' },
  { id: 'music', name: 'Музыка' },
  { id: 'technology', name: 'Технология' },
  { id: 'safety', name: 'ОБЖ' },
  { id: 'pe', name: 'Физическая культура' },
];

/**
 * Засидировать словари при первом запуске.
 * Идемпотентно: если стор уже не пуст, набор не трогаем (правки пользователя
 * сохраняются). Классы пересоздаём всегда (они фиксированы).
 */
export async function seedTaxonomy(): Promise<void> {
  const db = await getDB();

  // Классы фиксированы — поддерживаем актуальными.
  if ((await db.count('classes')) === 0) {
    const tx = db.transaction('classes', 'readwrite');
    await Promise.all(DEFAULT_CLASSES.map((c) => tx.store.put(c)));
    await tx.done;
  }

  if ((await db.count('categories')) === 0) {
    const tx = db.transaction('categories', 'readwrite');
    await Promise.all(DEFAULT_CATEGORIES.map((c) => tx.store.put(c)));
    await tx.done;
  }

  if ((await db.count('subjects')) === 0) {
    const tx = db.transaction('subjects', 'readwrite');
    await Promise.all(DEFAULT_SUBJECTS.map((s) => tx.store.put(s)));
    await tx.done;
  }
}

// --- Чтение словарей ---

/** Классы 1–11 (отсортированы по номеру). */
export async function listClasses(): Promise<ClassEntry[]> {
  const db = await getDB();
  const all = await db.getAll('classes');
  return all.sort((a, b) => a.number - b.number);
}

/** Категории (по алфавиту). */
export async function listCategories(): Promise<CategoryEntry[]> {
  const db = await getDB();
  const all = await db.getAll('categories');
  return all.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Предметы (по алфавиту). */
export async function listSubjects(): Promise<SubjectEntry[]> {
  const db = await getDB();
  const all = await db.getAll('subjects');
  return all.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// --- Редактирование предметов и категорий (классы неизменяемы) ---

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, '-')
    .replace(/^-+|-+$/g, '');
  return base || `id-${Date.now()}`;
}

/** Добавить предмет. Возвращает запись (с присвоенным id). */
export async function addSubject(name: string, id?: string): Promise<SubjectEntry> {
  const db = await getDB();
  const entry: SubjectEntry = { id: id ?? slugify(name), name: name.trim() };
  await db.put('subjects', entry);
  return entry;
}

/** Переименовать предмет. */
export async function renameSubject(id: string, name: string): Promise<void> {
  const db = await getDB();
  const cur = await db.get('subjects', id);
  if (cur) await db.put('subjects', { ...cur, name: name.trim() });
}

/** Удалить предмет из словаря (на книгах тег остаётся «осиротевшим» id). */
export async function removeSubject(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('subjects', id);
}

/** Добавить категорию. */
export async function addCategory(name: string, id?: string): Promise<CategoryEntry> {
  const db = await getDB();
  const entry: CategoryEntry = { id: id ?? slugify(name), name: name.trim() };
  await db.put('categories', entry);
  return entry;
}

/** Переименовать категорию. */
export async function renameCategory(id: string, name: string): Promise<void> {
  const db = await getDB();
  const cur = await db.get('categories', id);
  if (cur) await db.put('categories', { ...cur, name: name.trim() });
}

/** Удалить категорию. */
export async function removeCategory(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('categories', id);
}
