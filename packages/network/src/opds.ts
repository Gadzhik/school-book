/**
 * OPDS-парсер (ТЗ 4.4): читает Atom-фид каталога сервера в простую модель.
 * Совместим с OPDS 1.x (Atom). Парсим через DOMParser — клиент работает
 * в браузере/WebView (Tauri), где он доступен.
 *
 * OPDS даёт совместимость со сторонними читалками (Foliate/KOReader): тот же
 * фид читают и они, и наш клиент.
 */

/** Ссылка Atom/OPDS. */
export interface OpdsLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

/** Запись фида: либо навигация (подкаталог), либо книга (acquisition). */
export interface OpdsEntry {
  id: string;
  title: string;
  authors: string[];
  updated?: string;
  summary?: string;
  links: OpdsLink[];
  /** Ссылка на обложку/превью (rel image/thumbnail). */
  coverHref?: string;
  /** Ссылка скачивания книги (rel acquisition*). */
  acquisitionHref?: string;
  /** MIME скачиваемого файла (напр. application/epub+zip). */
  acquisitionType?: string;
  /** Классы книги из `<category scheme="urn:chitalka:class">` (ТЗ 5.6). */
  classes: string[];
  /** Предметы книги из `<category scheme="urn:chitalka:subject">`. */
  subjects: string[];
  /** Категории книги из `<category scheme="urn:chitalka:category">`. */
  categories: string[];
}

/** Разобранный фид OPDS. */
export interface OpdsFeed {
  title: string;
  links: OpdsLink[];
  entries: OpdsEntry[];
  /** true — навигационный фид (подкаталоги), иначе фид книг. */
  isNavigation: boolean;
}

const ACQUISITION_REL = 'http://opds-spec.org/acquisition';
const IMAGE_RELS = ['http://opds-spec.org/image', 'http://opds-spec.org/image/thumbnail'];

function text(el: Element | null): string {
  return el?.textContent?.trim() ?? '';
}

function parseLinks(parent: Element): OpdsLink[] {
  return [...parent.children]
    .filter((c) => c.localName === 'link')
    .map((c) => ({
      rel: c.getAttribute('rel') ?? '',
      href: c.getAttribute('href') ?? '',
      type: c.getAttribute('type') ?? undefined,
      title: c.getAttribute('title') ?? undefined,
    }))
    .filter((l) => l.href);
}

/** Схемы Atom-категорий нашего сервера → измерение классификации. */
const TAG_SCHEMES: Record<string, 'classes' | 'subjects' | 'categories'> = {
  'urn:chitalka:class': 'classes',
  'urn:chitalka:subject': 'subjects',
  'urn:chitalka:category': 'categories',
};

/**
 * Разобрать `<category>` записи по схемам сервера. Чужие схемы (сторонние
 * OPDS-каталоги) игнорируем — теги там свои и в нашу таксономию не ложатся.
 */
function parseTags(el: Element): Pick<OpdsEntry, 'classes' | 'subjects' | 'categories'> {
  const tags = { classes: [] as string[], subjects: [] as string[], categories: [] as string[] };
  for (const c of [...el.children]) {
    if (c.localName !== 'category') continue;
    const dim = TAG_SCHEMES[c.getAttribute('scheme') ?? ''];
    const term = c.getAttribute('term')?.trim();
    if (dim && term && !tags[dim].includes(term)) tags[dim].push(term);
  }
  return tags;
}

function parseEntry(el: Element): OpdsEntry {
  const links = parseLinks(el);
  const authors = [...el.children]
    .filter((c) => c.localName === 'author')
    .map((a) => text([...a.children].find((x) => x.localName === 'name') ?? null))
    .filter(Boolean);
  const cover = links.find((l) => IMAGE_RELS.includes(l.rel));
  const acq = links.find((l) => l.rel === ACQUISITION_REL || l.rel.startsWith(`${ACQUISITION_REL}/`));
  const titleEl = [...el.children].find((c) => c.localName === 'title');
  const idEl = [...el.children].find((c) => c.localName === 'id');
  const updatedEl = [...el.children].find((c) => c.localName === 'updated');
  const summaryEl = [...el.children].find((c) => c.localName === 'summary' || c.localName === 'content');
  return {
    id: text(idEl ?? null),
    title: text(titleEl ?? null),
    authors,
    updated: text(updatedEl ?? null) || undefined,
    summary: text(summaryEl ?? null) || undefined,
    links,
    coverHref: cover?.href,
    acquisitionHref: acq?.href,
    acquisitionType: acq?.type,
    ...parseTags(el),
  };
}

/** Разобрать XML OPDS-фида. Бросает при невалидном XML/не-фиде. */
export function parseOpds(xml: string): OpdsFeed {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('OPDS: некорректный XML');
  const feed = doc.documentElement;
  if (!feed || feed.localName !== 'feed') throw new Error('OPDS: ожидался Atom <feed>');

  const feedLinks = parseLinks(feed);
  const entries = [...feed.children]
    .filter((c) => c.localName === 'entry')
    .map(parseEntry);

  // Навигационный фид — у записей нет acquisition-ссылок.
  const isNavigation = entries.length > 0 && entries.every((e) => !e.acquisitionHref);
  const titleEl = [...feed.children].find((c) => c.localName === 'title');
  return {
    title: text(titleEl ?? null),
    links: feedLinks,
    entries,
    isNavigation,
  };
}

/** Абсолютизировать href записи относительно URL фида. */
export function resolveHref(href: string, feedUrl: string): string {
  try {
    return new URL(href, feedUrl).toString();
  } catch {
    return href;
  }
}
