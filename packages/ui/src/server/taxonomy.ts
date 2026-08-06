/**
 * Управление словарями школы (ТЗ 5.3, матрица прав 6.1: admin/power).
 * Источник истины — сервер: он хранит предметы и категории, клиенты тянут их
 * при подключении и кладут в локальные словари. Так переименованный предмет
 * виден всей школе, а не только тому, кто его правил.
 *
 * Классы (1–11) не редактируются: по ним привязаны пользователи и права.
 */
import { writable, get } from 'svelte/store';
import { applyServerTaxonomy, log, type ServerDictionaries } from '@reader/core';
import type { TaxonomyKind } from '@reader/network';
import { authedClient, session } from './auth';
import { currentClient as client } from './store';
import { loadTaxonomy } from '../classification';
import { tr } from '../i18n';

/** Словари, как их отдаёт сервер (для экрана управления). */
export const serverTaxonomy = writable<ServerDictionaries>({ subjects: [], categories: [] });
export const taxonomyBusy = writable(false);
export const taxonomyError = writable('');

/** Может ли роль править словари (ТЗ 6.1). */
export function canEditTaxonomy(role: string | undefined): boolean {
  return role === 'admin' || role === 'power';
}

/**
 * Забрать словари с сервера и применить к локальным. Тихо выходит, если
 * сервера нет: офлайн-первый клиент работает на своих словарях.
 * `silent` — не показывать ошибку (фоновая сверка при подключении).
 */
export async function pullTaxonomy(silent = false): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    const dict = await c.taxonomy();
    serverTaxonomy.set(dict);
    if (await applyServerTaxonomy(dict)) await loadTaxonomy();
  } catch (e) {
    if (!silent) {
      taxonomyError.set(
        e instanceof Error ? tr('Не удалось получить словари: {0}', tr(e.message)) : tr('Не удалось получить словари'),
      );
    } else {
      log.warn('server', 'словари школы недоступны — работаем на локальных', { e });
    }
  }
}

/** Добавить или переименовать запись словаря и сразу применить локально. */
export async function saveTaxonomyEntry(
  kind: TaxonomyKind,
  name: string,
  id?: string,
): Promise<boolean> {
  const c = authedClient();
  if (!c || !canEditTaxonomy(get(session)?.user.role) || !name.trim()) return false;
  taxonomyBusy.set(true);
  taxonomyError.set('');
  try {
    await c.saveTaxonomyEntry({ kind, id, name: name.trim() });
    await pullTaxonomy();
    return true;
  } catch (e) {
    taxonomyError.set(e instanceof Error ? tr(e.message) : tr('Не удалось сохранить'));
    return false;
  } finally {
    taxonomyBusy.set(false);
  }
}

/** Удалить запись словаря. Теги на книгах остаются, но перестают показываться. */
export async function deleteTaxonomyEntry(kind: TaxonomyKind, id: string): Promise<boolean> {
  const c = authedClient();
  if (!c || !canEditTaxonomy(get(session)?.user.role)) return false;
  taxonomyBusy.set(true);
  taxonomyError.set('');
  try {
    await c.deleteTaxonomyEntry(kind, id);
    await pullTaxonomy();
    return true;
  } catch (e) {
    taxonomyError.set(e instanceof Error ? tr(e.message) : tr('Не удалось удалить'));
    return false;
  } finally {
    taxonomyBusy.set(false);
  }
}
