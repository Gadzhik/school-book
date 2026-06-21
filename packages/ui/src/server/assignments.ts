/**
 * Задания и прогресс класса (ТЗ Часть 6, п.6.5). Учитель назначает классу
 * книгу с дедлайном и видит отчёт; ученик отмечает выполнение.
 */
import { writable, get } from 'svelte/store';
import type {
  Role,
  Assignment,
  AssignmentForStudent,
  AssignmentInput,
  AssignmentReportRow,
} from '@reader/network';
import { authedClient, session } from './auth';

export const assignments = writable<(Assignment | AssignmentForStudent)[]>([]);
export const assignmentsBusy = writable(false);
export const assignmentsError = writable('');
/** Книги сервера для выбора при создании задания: {id,title}. */
export const bookChoices = writable<{ id: string; title: string }[]>([]);
/** Отчёты по заданиям: assignmentId → строки. */
export const reports = writable<Record<string, AssignmentReportRow[]>>({});

/** Может ли роль создавать задания / видеть отчёты. */
export function canAssign(role: Role | undefined): boolean {
  return role === 'admin' || role === 'power' || role === 'teacher';
}

/** Личный статус есть только у ученика (AssignmentForStudent). */
export function isStudentView(a: Assignment | AssignmentForStudent): a is AssignmentForStudent {
  return 'status' in a;
}

/** Загрузить задания текущего пользователя. */
export async function loadAssignments(): Promise<void> {
  const c = authedClient();
  if (!c) return;
  assignmentsBusy.set(true);
  assignmentsError.set('');
  try {
    assignments.set(await c.listAssignments());
  } catch (e) {
    assignmentsError.set(e instanceof Error ? e.message : 'Не удалось загрузить задания');
  } finally {
    assignmentsBusy.set(false);
  }
}

/** Загрузить список книг сервера (для выбора при создании задания). */
export async function loadBookChoices(): Promise<void> {
  const c = authedClient();
  if (!c) return;
  try {
    const { feed } = await c.catalog('/opds/all');
    const choices: { id: string; title: string }[] = [];
    for (const e of feed.entries) {
      const id = /\/books\/([^/]+)\/file/.exec(e.acquisitionHref ?? '')?.[1];
      if (id) choices.push({ id, title: e.title });
    }
    bookChoices.set(choices);
  } catch {
    bookChoices.set([]);
  }
}

/** Создать задание. */
export async function createAssignment(input: AssignmentInput): Promise<boolean> {
  const c = authedClient();
  if (!c) return false;
  assignmentsBusy.set(true);
  assignmentsError.set('');
  try {
    await c.createAssignment(input);
    await loadAssignments();
    return true;
  } catch (e) {
    assignmentsError.set(e instanceof Error ? e.message : 'Не удалось создать задание');
    return false;
  } finally {
    assignmentsBusy.set(false);
  }
}

/** Удалить задание. */
export async function deleteAssignment(id: string): Promise<void> {
  const c = authedClient();
  if (!c) return;
  try {
    await c.deleteAssignment(id);
    await loadAssignments();
  } catch (e) {
    assignmentsError.set(e instanceof Error ? e.message : 'Не удалось удалить');
  }
}

/** Отметить выполнение задания учеником. */
export async function markProgress(id: string, status: 'reading' | 'done'): Promise<void> {
  const c = authedClient();
  if (!c) return;
  try {
    await c.setAssignmentProgress(id, status, status === 'done' ? 1 : 0);
    await loadAssignments();
  } catch (e) {
    assignmentsError.set(e instanceof Error ? e.message : 'Не удалось отметить');
  }
}

/** Загрузить отчёт по заданию (учитель/админ). */
export async function loadReport(id: string): Promise<void> {
  const c = authedClient();
  if (!c) return;
  try {
    const rows = await c.assignmentReport(id);
    reports.update((r) => ({ ...r, [id]: rows }));
  } catch (e) {
    assignmentsError.set(e instanceof Error ? e.message : 'Не удалось загрузить отчёт');
  }
}

/** Метки классов из таксономии не нужны — id числовой; вернём как есть. */
export function currentRole(): Role | undefined {
  return get(session)?.user.role;
}
