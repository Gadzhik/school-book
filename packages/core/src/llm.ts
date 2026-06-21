/**
 * Локальная LLM: авторазметка (ТЗ 5.4 #3) и помощник чтения (Часть 3).
 * Поддержаны два локальных провайдера — приватно, офлайн, без облака:
 *   - Ollama        (нативный API /api/chat, /api/tags)
 *   - LM Studio     (OpenAI-совместимый API /v1/chat/completions, /v1/models)
 * Провайдер/URL/модель настраиваются (см. ReaderSettings + setLlmConfig).
 *
 * Всё graceful: если сервер не запущен/недоступен — функции отдают пустой
 * результат, читалка работает как прежде (эвристики autotag).
 *
 * Для веб-клиента нужен CORS-доступ из браузера:
 *   - Ollama:    запустить с OLLAMA_ORIGINS=*
 *   - LM Studio: включить CORS в настройках сервера (Developer → Enable CORS).
 * В нативной оболочке (Tauri) ограничений нет.
 */
import { listSubjects, listCategories } from './taxonomy';
import type { AutoTags } from './autotag';

/** Поддерживаемые локальные провайдеры LLM. */
export type LlmProvider = 'ollama' | 'lmstudio';

/** Базовый URL по умолчанию для каждого провайдера. */
const PROVIDER_URL: Record<LlmProvider, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

/** Модель по умолчанию (пустая у LM Studio → берём первую загруженную). */
const PROVIDER_MODEL: Record<LlmProvider, string> = {
  ollama: 'llama3.2',
  lmstudio: '',
};

export const DEFAULT_OLLAMA_URL = PROVIDER_URL.ollama;
export const DEFAULT_OLLAMA_MODEL = PROVIDER_MODEL.ollama;

export interface LlmOptions {
  /** Провайдер LLM. */
  provider?: LlmProvider;
  /** Базовый URL (переопределяет дефолт провайдера). */
  url?: string;
  /** Имя модели (переопределяет дефолт провайдера). */
  model?: string;
  /** Таймаут запроса, мс. */
  timeoutMs?: number;
}

// Глобальная конфигурация LLM (задаётся из настроек приложения).
let globalConfig: Required<Pick<LlmOptions, 'provider'>> & Pick<LlmOptions, 'url' | 'model'> = {
  provider: 'ollama',
  url: '',
  model: '',
};

/** Задать конфигурацию LLM из настроек (провайдер/URL/модель). Пустое — дефолт. */
export function setLlmConfig(cfg: { provider?: LlmProvider; url?: string; model?: string }): void {
  globalConfig = {
    provider: cfg.provider ?? globalConfig.provider,
    url: cfg.url ?? globalConfig.url,
    model: cfg.model ?? globalConfig.model,
  };
}

interface ResolvedConfig {
  provider: LlmProvider;
  url: string;
  model: string;
  timeoutMs: number;
}

/** Слить опции вызова с глобальной конфигурацией и дефолтами провайдера. */
function resolve(opts: LlmOptions, defaultTimeout: number): ResolvedConfig {
  const provider = opts.provider ?? globalConfig.provider;
  const url = (opts.url || globalConfig.url || PROVIDER_URL[provider]).replace(/\/$/, '');
  const model = opts.model || globalConfig.model || PROVIDER_MODEL[provider];
  return { provider, url, model, timeoutMs: opts.timeoutMs ?? defaultTimeout };
}

/** fetch с таймаутом через AbortController. */
async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Кэш первой загруженной модели LM Studio по базовому URL.
const lmstudioModelCache = new Map<string, string>();

/** Узнать id модели LM Studio (первой из /v1/models), если модель не задана. */
async function resolveLmStudioModel(url: string, timeoutMs: number): Promise<string> {
  const cached = lmstudioModelCache.get(url);
  if (cached) return cached;
  const res = await fetchTimeout(`${url}/v1/models`, { method: 'GET' }, timeoutMs);
  if (!res.ok) throw new Error(`LM Studio ответил ${res.status}`);
  const data = (await res.json()) as { data?: { id?: string }[] };
  const id = data.data?.[0]?.id;
  if (!id) throw new Error('LM Studio: нет загруженной модели');
  lmstudioModelCache.set(url, id);
  return id;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Единый чат-запрос к выбранному провайдеру → текст ответа.
 * Бросает при ошибке/недоступности. json=true просит структурированный JSON.
 */
async function chat(
  messages: ChatMessage[],
  o: { json: boolean; temperature: number },
  cfg: ResolvedConfig,
): Promise<string> {
  if (cfg.provider === 'lmstudio') {
    const model = cfg.model || (await resolveLmStudioModel(cfg.url, cfg.timeoutMs));
    const res = await fetchTimeout(
      `${cfg.url}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature: o.temperature,
          stream: false,
          ...(o.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      },
      cfg.timeoutMs,
    );
    if (!res.ok) throw new Error(`LM Studio ответил ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Пустой ответ модели');
    return text;
  }

  // Ollama (нативный API).
  const res = await fetchTimeout(
    `${cfg.url}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: { temperature: o.temperature },
        ...(o.json ? { format: 'json' } : {}),
      }),
    },
    cfg.timeoutMs,
  );
  if (!res.ok) throw new Error(`Ollama ответил ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content?.trim();
  if (!text) throw new Error('Пустой ответ модели');
  return text;
}

/** Доступен ли выбранный провайдер (быстрый пинг списка моделей). */
export async function isLlmAvailable(opts: LlmOptions = {}): Promise<boolean> {
  const cfg = resolve(opts, 1500);
  const path = cfg.provider === 'lmstudio' ? '/v1/models' : '/api/tags';
  try {
    const res = await fetchTimeout(`${cfg.url}${path}`, { method: 'GET' }, cfg.timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

/** Обратная совместимость: пинг доступности LLM (имя сохранено). */
export const isOllamaAvailable = isLlmAvailable;

/**
 * Объяснить фрагмент простыми словами для школьника (помощник чтения,
 * ТЗ Часть 3). Локально, приватно. Бросает при недоступности.
 */
export function explainText(text: string, opts: LlmOptions = {}): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content:
          'Ты добрый помощник школьника. Объясни смысл простыми и короткими словами, ' +
          'по-русски, без сложных терминов. Если есть трудное слово — поясни его. ' +
          'Отвечай 2–4 предложениями.',
      },
      { role: 'user', content: `Объясни простыми словами:\n"""${text.slice(0, 2000)}"""` },
    ],
    { json: false, temperature: 0.3 },
    resolve(opts, 60000),
  );
}

/** Краткое содержание фрагмента простыми словами (помощник чтения). */
export function summarizeText(text: string, opts: LlmOptions = {}): Promise<string> {
  return chat(
    [
      {
        role: 'system',
        content:
          'Ты помощник школьника. Сделай очень краткое содержание простыми словами ' +
          'по-русски: о чём этот фрагмент. 1–3 предложения, без воды.',
      },
      { role: 'user', content: `Сделай краткое содержание:\n"""${text.slice(0, 4000)}"""` },
    ],
    { json: false, temperature: 0.3 },
    resolve(opts, 60000),
  );
}

/**
 * Разбить текст на части по границам абзацев так, чтобы каждая влезла в
 * контекст модели (примерно maxChars символов).
 */
function chunkByParagraph(text: string, maxChars: number): string[] {
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > maxChars) {
      chunks.push(buf);
      buf = '';
    }
    // Одиночный абзац длиннее лимита — режем по предложениям/словам.
    if (p.length > maxChars) {
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      continue;
    }
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * LLM-постобработка распознанного (OCR) текста (фича «книга из фото», Stage B):
 * исправляет ошибки распознавания, восстанавливает абзацы, убирает переносы
 * слов в конце строк. НЕ переводит, НЕ добавляет и НЕ удаляет содержание.
 *
 * Полностью graceful: при недоступности модели/ошибке возвращает исходный
 * текст без изменений (офлайн-first, как и весь LLM-слой).
 */
export async function cleanupOcrText(text: string, opts: LlmOptions = {}): Promise<string> {
  const src = text.trim();
  if (src.length < 20) return text; // пусто/слишком мало — нет смысла
  const cfg = resolve(opts, 60000);
  const system =
    'Ты редактор текста, распознанного программой OCR со скана страницы книги. ' +
    'Исправь ошибки распознавания (перепутанные буквы, лишние символы, склейки/разрывы слов), ' +
    'убери переносы слов в конце строк, восстанови естественные абзацы. ' +
    'НЕ переводи на другой язык, сохрани исходный язык. ' +
    'НЕ добавляй и НЕ выбрасывай содержание, не комментируй. ' +
    'Верни ТОЛЬКО исправленный текст, без пояснений и кавычек.';

  const chunks = chunkByParagraph(src, 3000);
  try {
    const out: string[] = [];
    for (const chunk of chunks) {
      const fixed = await chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: chunk },
        ],
        { json: false, temperature: 0.2 },
        cfg,
      );
      out.push(fixed.trim());
    }
    const joined = out.join('\n\n').trim();
    return joined || text;
  } catch {
    return text; // модель недоступна — отдаём исходный OCR-текст
  }
}

/** Вопрос квиза на понимание (ТЗ Часть 6, E4). */
export interface QuizQuestion {
  /** Текст вопроса. */
  q: string;
  /** Варианты ответа (2–4). */
  options: string[];
  /** Индекс правильного варианта (0-based). */
  correct: number;
  /** Короткое пояснение к правильному ответу. */
  explain?: string;
}

interface QuizAnswer {
  questions?: unknown;
}

/**
 * Сгенерировать квиз на понимание по тексту главы (ТЗ Часть 6, E4).
 * Локальная LLM, офлайн. Бросает при недоступности модели. Возвращает только
 * корректные вопросы (с вариантами и валидным индексом ответа).
 */
export async function generateQuiz(
  text: string,
  opts: { count?: number } & LlmOptions = {},
): Promise<QuizQuestion[]> {
  const count = Math.max(1, Math.min(opts.count ?? 5, 10));
  const system =
    'Ты учитель. По данному тексту составь вопросы с выбором ответа для проверки ' +
    `понимания учеником. Сделай ${count} вопросов. У каждого ровно 4 варианта и ` +
    'ровно один правильный. Пиши по-русски, просто и по тексту (не выдумывай факты). ' +
    'Верни СТРОГО JSON: {"questions":[{"q":"...","options":["A","B","C","D"],' +
    '"correct":0,"explain":"..."}]}. Поле correct — индекс правильного варианта (0..3).';

  const content = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: text.slice(0, 6000) },
    ],
    { json: true, temperature: 0.4 },
    resolve(opts, 90000),
  );

  let parsed: QuizAnswer;
  try {
    parsed = JSON.parse(content) as QuizAnswer;
  } catch {
    throw new Error('Модель вернула некорректный ответ');
  }
  const raw = Array.isArray(parsed.questions) ? parsed.questions : [];
  const out: QuizQuestion[] = [];
  for (const item of raw) {
    const o = item as Record<string, unknown>;
    const q = typeof o.q === 'string' ? o.q.trim() : '';
    const options = Array.isArray(o.options)
      ? o.options.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const correct = Number(o.correct);
    if (q && options.length >= 2 && Number.isInteger(correct) && correct >= 0 && correct < options.length) {
      out.push({ q, options, correct, explain: typeof o.explain === 'string' ? o.explain : undefined });
    }
  }
  if (out.length === 0) throw new Error('Не удалось составить вопросы по этому тексту');
  return out;
}

export interface LlmClassifyInput {
  title: string;
  author?: string;
  /** Имя файла (часто содержит «7 класс» и т.п.). */
  fileName?: string;
  /** Короткий фрагмент текста книги, если доступен. */
  excerpt?: string;
}

/** Нормализация для сопоставления названий (регистр, ё, пробелы). */
function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Тело JSON-ответа модели. */
interface LlmAnswer {
  classes?: unknown;
  subjects?: unknown;
  categories?: unknown;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  if (typeof v === 'number') return [String(v)];
  return [];
}

/**
 * Предложить теги книги через LLM. Возвращает id из управляемых словарей
 * (несуществующие/неугаданные значения отбрасываются). При любой ошибке —
 * пустой результат (graceful). Результат подлежит подтверждению человеком.
 */
export async function classifyBookLLM(
  input: LlmClassifyInput,
  opts: LlmOptions = {},
): Promise<AutoTags> {
  const empty: AutoTags = { classes: [], subjects: [], categories: [] };

  // Словари — ограничиваем модель допустимыми значениями.
  const [subjects, categories] = await Promise.all([listSubjects(), listCategories()]);
  const subjectByName = new Map(subjects.map((s) => [norm(s.name), s.id]));
  const categoryByName = new Map(categories.map((c) => [norm(c.name), c.id]));

  const system =
    'Ты школьный библиотекарь. По данным о книге определи учебный класс (число 1–11), ' +
    'школьный предмет и тип материала. Выбирай ТОЛЬКО из разрешённых списков. ' +
    'Если не уверен — оставь поле пустым массивом. Отвечай строго JSON-объектом ' +
    'с ключами classes (числа), subjects (точные названия), categories (точные названия).';
  const user = [
    `Название: ${input.title}`,
    input.author ? `Автор: ${input.author}` : '',
    input.fileName ? `Файл: ${input.fileName}` : '',
    input.excerpt ? `Фрагмент: ${input.excerpt.slice(0, 800)}` : '',
    '',
    `Разрешённые предметы: ${subjects.map((s) => s.name).join(', ')}`,
    `Разрешённые типы материала: ${categories.map((c) => c.name).join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');

  let answer: LlmAnswer;
  try {
    const content = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { json: true, temperature: 0 },
      resolve(opts, 30000),
    );
    answer = JSON.parse(content) as LlmAnswer;
  } catch {
    return empty;
  }

  // Классы: числа 1–11.
  const classes = [
    ...new Set(
      asStringArray(answer.classes)
        .map((s) => parseInt(s, 10))
        .filter((n) => n >= 1 && n <= 11)
        .map(String),
    ),
  ];
  const mapNames = (vals: string[], dict: Map<string, string>): string[] => [
    ...new Set(vals.map((v) => dict.get(norm(v))).filter((x): x is string => Boolean(x))),
  ];

  return {
    classes,
    subjects: mapNames(asStringArray(answer.subjects), subjectByName),
    categories: mapNames(asStringArray(answer.categories), categoryByName),
  };
}
