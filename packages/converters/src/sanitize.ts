/**
 * Очистка HTML до безопасного XHTML-фрагмента для вставки в EPUB.
 * Удаляем скрипты, стили-исполнители, обработчики событий и опасные URL.
 * В браузере используем DOMParser; в node (тесты) — лёгкий regex-фолбэк.
 */

const DROP_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base'];

export interface SanitizedHtml {
  /** Заголовок (из <title> или первого заголовка), если найден. */
  title?: string;
  /** Очищенное содержимое для тела главы (валидный XHTML-фрагмент). */
  bodyHtml: string;
}

/** Очистка через DOM (браузер). */
function sanitizeViaDom(html: string): SanitizedHtml {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const tag of DROP_TAGS) {
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  }
  // Удаляем обработчики событий и javascript:-ссылки.
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  const title =
    doc.querySelector('title')?.textContent?.trim() ||
    doc.querySelector('h1,h2')?.textContent?.trim() ||
    undefined;

  // XHTML-сериализация тела (самозакрывающиеся теги и т.п.).
  const body = doc.body ?? doc.documentElement;
  const bodyHtml = new XMLSerializer()
    .serializeToString(body)
    .replace(/^<body[^>]*>/i, '')
    .replace(/<\/body>$/i, '');
  return { title, bodyHtml };
}

/** Грубая очистка без DOM (node/тесты): срезаем опасные блоки. */
function sanitizeViaRegex(html: string): SanitizedHtml {
  let s = html;
  for (const tag of DROP_TAGS) {
    s = s.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi'), '');
    s = s.replace(new RegExp(`<${tag}[^>]*/?>`, 'gi'), '');
  }
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = (titleMatch?.[1] ?? h1Match?.[1])?.replace(/<[^>]+>/g, '').trim() || undefined;
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(s);
  const bodyHtml = bodyMatch ? bodyMatch[1] : s;
  return { title, bodyHtml };
}

/** Очистить HTML-строку. */
export function sanitizeHtml(html: string): SanitizedHtml {
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    return sanitizeViaDom(html);
  }
  return sanitizeViaRegex(html);
}
