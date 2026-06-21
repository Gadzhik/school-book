/**
 * Минимальный конвертер RTF → единая модель документа.
 * Извлекает текст с абзацами; корректно декодирует кириллицу из
 * \'XX (Windows-1251) и \uN — частый случай «грязных» русских RTF (ТЗ).
 * Это не полноценный рендер RTF, а надёжное извлечение читаемого текста.
 */
import type { Converter, NormalizedDoc } from '../types';
import { escapeXml } from '../epub/build';

// Windows-1251: коды 0x80–0xBF (нерегулярная часть). 0xC0–0xFF считаем формулой.
const CP1251_HI: Record<number, number> = {
  0x80: 0x0402, 0x81: 0x0403, 0x82: 0x201a, 0x83: 0x0453, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x20ac, 0x89: 0x2030,
  0x8a: 0x0409, 0x8b: 0x2039, 0x8c: 0x040a, 0x8d: 0x040c, 0x8e: 0x040b,
  0x8f: 0x040f, 0x90: 0x0452, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x99: 0x2122,
  0x9a: 0x0459, 0x9b: 0x203a, 0x9c: 0x045a, 0x9d: 0x045c, 0x9e: 0x045b,
  0x9f: 0x045f, 0xa0: 0x00a0, 0xa1: 0x040e, 0xa2: 0x045e, 0xa3: 0x0408,
  0xa4: 0x00a4, 0xa5: 0x0490, 0xa6: 0x00a6, 0xa7: 0x00a7, 0xa8: 0x0401,
  0xa9: 0x00a9, 0xaa: 0x0404, 0xab: 0x00ab, 0xac: 0x00ac, 0xad: 0x00ad,
  0xae: 0x00ae, 0xaf: 0x0407, 0xb0: 0x00b0, 0xb1: 0x00b1, 0xb2: 0x0406,
  0xb3: 0x0456, 0xb4: 0x0491, 0xb5: 0x00b5, 0xb6: 0x00b6, 0xb7: 0x00b7,
  0xb8: 0x0451, 0xb9: 0x2116, 0xba: 0x0454, 0xbb: 0x00bb, 0xbc: 0x0458,
  0xbd: 0x0405, 0xbe: 0x0455, 0xbf: 0x0457,
};

function cp1251(byte: number): string {
  if (byte < 0x80) return String.fromCharCode(byte);
  if (byte >= 0xc0) return String.fromCharCode(0x0410 + (byte - 0xc0)); // А..я
  const u = CP1251_HI[byte];
  return u ? String.fromCharCode(u) : '';
}

/** Группы-приёмники, которые целиком пропускаем (не текст). */
const SKIP_DESTINATIONS = /^(fonttbl|colortbl|stylesheet|info|pict|\*|themedata|colorschememapping|latentstyles|datastore)/;

/** Разобрать RTF в массив абзацев простого текста. */
function rtfToParagraphs(rtf: string): string[] {
  const paragraphs: string[] = [];
  let cur = '';
  const skipStack: boolean[] = [];
  let skipDepth = 0; // глубина пропускаемой группы

  let i = 0;
  const n = rtf.length;
  const pushPar = () => {
    paragraphs.push(cur);
    cur = '';
  };

  while (i < n) {
    const ch = rtf[i];

    if (ch === '{') {
      skipStack.push(skipDepth > 0);
      // Заглянем: начинается ли группа с управляющего приёмника для пропуска.
      const m = /^\{\\\*?\\?([a-z]+)/i.exec(rtf.slice(i, i + 20));
      if (skipDepth > 0) skipDepth++;
      else if (m && SKIP_DESTINATIONS.test(m[1])) skipDepth = 1;
      else if (rtf.slice(i, i + 2) === '{\\*') skipDepth = 1;
      i++;
      continue;
    }
    if (ch === '}') {
      if (skipDepth > 0) skipDepth--;
      skipStack.pop();
      i++;
      continue;
    }

    if (ch === '\\') {
      const next = rtf[i + 1];
      // Экранированные символы.
      if (next === '\\' || next === '{' || next === '}') {
        if (skipDepth === 0) cur += next;
        i += 2;
        continue;
      }
      if (next === '~') { if (skipDepth === 0) cur += ' '; i += 2; continue; }
      if (next === '-' || next === '_') { i += 2; continue; }
      if (next === '*') { i += 2; continue; }

      // \'XX — байт в текущей кодовой странице (считаем 1251).
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        if (skipDepth === 0) cur += cp1251(parseInt(hex, 16));
        i += 4;
        continue;
      }

      // Управляющее слово \word[-N][ ]
      const cw = /^\\([a-z]+)(-?\d+)?\s?/i.exec(rtf.slice(i));
      if (cw) {
        const word = cw[1].toLowerCase();
        const param = cw[2];
        if (word === 'par' || word === 'pard') {
          if (skipDepth === 0) pushPar();
        } else if (word === 'line') {
          if (skipDepth === 0) cur += '\n';
        } else if (word === 'tab') {
          if (skipDepth === 0) cur += '\t';
        } else if (word === 'u') {
          // \uN — Unicode; за ним идёт символ-замена, его пропускаем.
          if (skipDepth === 0 && param) {
            let code = parseInt(param, 10);
            if (code < 0) code += 65536;
            cur += String.fromCharCode(code);
          }
        }
        i += cw[0].length;
        // после \uN пропустить один символ замены
        if (word === 'u') i += 1;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (skipDepth === 0) cur += ch;
    i++;
  }
  if (cur.trim()) pushPar();
  return paragraphs.filter((p) => p.trim());
}

function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs
    .map((p) => `<p>${escapeXml(p.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

export const rtfConverter: Converter = {
  name: 'rtf',
  formats: ['rtf'],
  async convert(file): Promise<NormalizedDoc> {
    // RTF — ASCII-контейнер; читаем как latin1, чтобы сохранить байты \'XX.
    const buf = new Uint8Array(await file.arrayBuffer());
    let rtf = '';
    for (let i = 0; i < buf.length; i++) rtf += String.fromCharCode(buf[i]);
    const paragraphs = rtfToParagraphs(rtf);
    return {
      metadata: { language: 'ru' },
      chapters: [{ id: 'ch1', html: paragraphsToHtml(paragraphs) }],
    };
  },
};
