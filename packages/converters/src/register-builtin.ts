/**
 * Регистрация встроенных конвертеров (без тяжёлых зависимостей).
 * Выполняется как побочный эффект при импорте пакета — см. index.ts.
 * DOCX/RTF/ODT и PDF→текст добавляются в следующих модулях.
 */
import { registerConverter } from './registry';
import { htmlConverter } from './formats/html';
import { markdownConverter } from './formats/markdown';
import { textConverter } from './formats/text';
import { docxConverter } from './formats/docx';
import { rtfConverter } from './formats/rtf';
import { odtConverter } from './formats/odt';

registerConverter(htmlConverter);
registerConverter(markdownConverter);
registerConverter(textConverter);
registerConverter(docxConverter);
registerConverter(rtfConverter);
registerConverter(odtConverter);
