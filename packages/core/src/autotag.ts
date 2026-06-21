/**
 * Авторазметка книги (ТЗ Часть 5, раздел 5.4): из имени файла и метаданных
 * предлагаем класс/предмет/категорию. Эвристики офлайн, без облака.
 * Принцип ТЗ: предлагаем, а не навязываем — теги остаются редактируемыми.
 *
 * id предметов/категорий совпадают с дефолтной таксономией (taxonomy.ts).
 */

export interface AutoTagInput {
  fileName: string;
  title?: string;
  author?: string;
  /**
   * Свободные предметные метки из метаданных книги
   * (EPUB `dc:subject`, ключевые слова FB2). ТЗ 5.4, источник #1.
   */
  keywords?: string[];
  /** Коды жанров FB2 (`<genre>`), напр. 'sci_phys'. ТЗ 5.4, источник #1. */
  fb2Genres?: string[];
  /** Название серии/коллекции (часто «Алгебра. 7 класс»). */
  series?: string;
}

export interface AutoTags {
  classes: string[];
  subjects: string[];
  categories: string[];
}

// Ключевые слова (стемы) предметов → id таксономии.
const SUBJECT_KEYWORDS: [string, string[]][] = [
  ['russian', ['русск']],
  ['literature', ['литератур', 'чтение']],
  ['algebra', ['алгебр']],
  ['geometry', ['геометр']],
  ['math', ['математик']],
  ['informatics', ['информатик', 'программир']],
  ['physics', ['физик']],
  ['chemistry', ['хими']],
  ['biology', ['биолог']],
  ['geography', ['географ']],
  ['history', ['истори']],
  ['social', ['обществозн', 'общество']],
  ['foreign', ['английск', 'немецк', 'французск', 'иностранн']],
  ['world', ['окружающ']],
  ['astronomy', ['астроном']],
  ['art', ['изобразит', 'рисован', 'изо ']],
  ['music', ['музык']],
  ['technology', ['технолог']],
  ['safety', ['обж', 'безопасност']],
  ['pe', ['физкультур', 'физическ']],
];

// Ключевые слова категорий → id.
const CATEGORY_KEYWORDS: [string, string[]][] = [
  ['workbook', ['рабочая тетрад', 'тетрадь']],
  ['textbook', ['учебник']],
  ['manual', ['пособие', 'практикум']],
  ['reader', ['хрестомат']],
  ['reference', ['словар', 'справочник', 'энциклопед']],
  ['atlas', ['атлас']],
  ['comic', ['комикс', 'манга']],
  ['extracurricular', ['внеклассн']],
];

/**
 * Коды жанров FB2 (`<genre>`) → id предмета таксономии.
 * Только школьно-предметные коды; беллетристика сюда не входит (см. категории).
 */
const FB2_GENRE_SUBJECT: Record<string, string> = {
  sci_phys: 'physics',
  sci_math: 'math',
  sci_chem: 'chemistry',
  sci_biology: 'biology',
  sci_medicine: 'biology',
  sci_history: 'history',
  sci_geo: 'geography',
  geo_guides: 'geography',
  sci_politics: 'social',
  sci_juris: 'social',
  sci_economy: 'social',
  sci_linguistic: 'russian',
  sci_philology: 'literature',
  sci_tech: 'technology',
  sci_cybernetics: 'informatics',
  comp_programming: 'informatics',
  comp_hard: 'informatics',
  comp_soft: 'informatics',
  comp_db: 'informatics',
  comp_www: 'informatics',
  computers: 'informatics',
  foreign_language: 'foreign',
};

/**
 * Коды жанров FB2 → id категории (тип материала).
 * Беллетристика → «художественная», научпоп → «научпоп» и т.д.
 */
const FB2_GENRE_CATEGORY: Record<string, string> = {
  science: 'popsci',
  sci_popular: 'popsci',
  reference: 'reference',
  dictionaries: 'reference',
  ref_encyc: 'reference',
  ref_dict: 'reference',
  comics: 'comic',
};

// Префиксы FB2-жанров беллетристики → категория «художественная».
const FB2_FICTION_PREFIXES = [
  'prose',
  'poetry',
  'dramaturgy',
  'sf',
  'det_',
  'love_',
  'adv_',
  'thriller',
  'antique',
  'children',
  'child_',
  'fairy',
  'humor',
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

/** Предложить теги по имени файла, заголовку и метаданным книги (ТЗ 5.4). */
export function suggestTags(input: AutoTagInput): AutoTags {
  const parts = [
    input.fileName,
    input.title ?? '',
    input.series ?? '',
    ...(input.keywords ?? []),
  ];
  const hay = normalize(parts.join(' '));

  // Классы: «7 класс», «7 кл», «5-6 класс», «за 9 кл.»
  const classes = new Set<string>();
  const re = /(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*(?:класс|кл\b|кл\.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) {
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) {
      if (c >= 1 && c <= 11) classes.add(String(c));
    }
  }

  // Предметы: первый подходящий стем (порядок важен: алгебра до математики).
  const subjects = new Set<string>();
  for (const [id, kws] of SUBJECT_KEYWORDS) {
    if (kws.some((k) => hay.includes(k))) subjects.add(id);
  }

  const categories = new Set<string>();
  for (const [id, kws] of CATEGORY_KEYWORDS) {
    if (kws.some((k) => hay.includes(k))) categories.add(id);
  }

  // Коды жанров FB2 → предмет/категория (источник #1, точнее эвристик по тексту).
  for (const raw of input.fb2Genres ?? []) {
    const g = raw.trim().toLowerCase();
    if (!g) continue;
    if (FB2_GENRE_SUBJECT[g]) subjects.add(FB2_GENRE_SUBJECT[g]);
    if (FB2_GENRE_CATEGORY[g]) categories.add(FB2_GENRE_CATEGORY[g]);
    if (FB2_FICTION_PREFIXES.some((p) => g.startsWith(p))) categories.add('fiction');
  }

  return {
    classes: [...classes],
    subjects: [...subjects],
    categories: [...categories],
  };
}
