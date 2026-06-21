//! Извлечение метаданных книги на сервере (Фаза 5): реальные заголовок и
//! автор из EPUB (OPF) и FB2 (title-info). Зеркалит клиентский
//! `packages/converters/src/metadata.ts`. Парсим regex'ом — устойчиво к
//! пространствам имён, без полноценного XML-парсера.

use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;

/// Извлечённые метаданные (то, что улучшает карточку каталога и автотег).
#[derive(Debug, Default)]
pub struct Meta {
    pub title: Option<String>,
    pub author: Option<String>,
    /// Свободные предметные метки: EPUB dc:subject, FB2 keywords.
    pub keywords: Vec<String>,
    /// Коды жанров FB2 (<genre>), напр. 'sci_phys'.
    pub fb2_genres: Vec<String>,
}

/// Текст первого тега с данным локальным именем (с любым namespace-префиксом).
fn tag_text(xml: &str, local: &str) -> Option<String> {
    // Кэшируем скомпилированные регэкспы по имени тега.
    static CACHE: OnceLock<std::sync::Mutex<std::collections::HashMap<String, Regex>>> =
        OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    let mut map = cache.lock().unwrap();
    let re = map.entry(local.to_string()).or_insert_with(|| {
        Regex::new(&format!(
            r"(?is)<(?:\w+:)?{0}\b[^>]*>(.*?)</(?:\w+:)?{0}>",
            regex::escape(local)
        ))
        .unwrap()
    });
    re.captures(xml)
        .map(|c| decode_entities(c[1].trim()))
        .filter(|s| !s.is_empty())
}

/// Тексты всех вхождений тега с данным локальным именем.
fn tag_all(xml: &str, local: &str) -> Vec<String> {
    let re = Regex::new(&format!(
        r"(?is)<(?:\w+:)?{0}\b[^>]*>(.*?)</(?:\w+:)?{0}>",
        regex::escape(local)
    ))
    .unwrap();
    re.captures_iter(xml)
        .map(|c| decode_entities(c[1].trim()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Снять простейшие XML-сущности и схлопнуть пробелы.
fn decode_entities(s: &str) -> String {
    let s = s
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Декодировать байты XML с учётом кодировки из декларации (часто cp1251).
fn decode_xml(bytes: &[u8]) -> String {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]);
    if let Some(enc) = Regex::new(r#"(?i)encoding=["']([\w-]+)["']"#)
        .unwrap()
        .captures(&head)
        .map(|c| c[1].to_lowercase())
    {
        if enc != "utf-8" && enc != "utf8" {
            if let Some(encoding) = encoding_rs::Encoding::for_label(enc.as_bytes()) {
                return encoding.decode(bytes).0.into_owned();
            }
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// Разобрать OPF (EPUB): dc:title, dc:creator, dc:subject.
fn parse_opf(xml: &str) -> Meta {
    Meta {
        title: tag_text(xml, "title"),
        author: tag_text(xml, "creator"),
        keywords: tag_all(xml, "subject"),
        fb2_genres: Vec::new(),
    }
}

/// Разобрать FB2: блок <title-info> → book-title, автор (имя+фамилия).
fn parse_fb2(xml: &str) -> Meta {
    let ti = Regex::new(r"(?is)<title-info\b[^>]*>(.*?)</title-info>")
        .unwrap()
        .captures(xml)
        .map(|c| c[1].to_string())
        .unwrap_or_else(|| xml.to_string());
    let author = Regex::new(r"(?is)<author\b[^>]*>(.*?)</author>")
        .unwrap()
        .captures(&ti)
        .and_then(|c| {
            let a = &c[1];
            let fn_ = tag_text(a, "first-name").unwrap_or_default();
            let ln = tag_text(a, "last-name").unwrap_or_default();
            let full = format!("{fn_} {ln}").trim().to_string();
            if full.is_empty() {
                tag_text(a, "nickname")
            } else {
                Some(full)
            }
        });
    let keywords = tag_all(&ti, "keywords")
        .into_iter()
        .flat_map(|k| k.split([',', ';']).map(|s| s.trim().to_string()).collect::<Vec<_>>())
        .filter(|s| !s.is_empty())
        .collect();
    Meta {
        title: tag_text(&ti, "book-title"),
        author,
        keywords,
        fb2_genres: tag_all(&ti, "genre").iter().map(|g| g.to_lowercase()).collect(),
    }
}

/// Прочитать первый файл по предикату имени из zip-архива.
fn read_zip_entry<F: Fn(&str) -> bool>(path: &Path, pick: F) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    // Сначала ищем по container.xml (EPUB), иначе — по предикату.
    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();
    let target = names.into_iter().find(|n| pick(n))?;
    let mut buf = Vec::new();
    zip.by_name(&target).ok()?.read_to_end(&mut buf).ok()?;
    Some(buf)
}

/// Имя первой записи zip, удовлетворяющей предикату.
fn zip_find_name<F: Fn(&str) -> bool>(path: &Path, pred: F) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let zip = zip::ZipArchive::new(file).ok()?;
    let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
    names.into_iter().find(|n| pred(n))
}

/// Путь к OPF внутри EPUB из META-INF/container.xml (иначе первый .opf).
fn epub_opf(path: &Path) -> Option<String> {
    if let Some(bytes) = read_zip_entry(path, |n| n == "META-INF/container.xml") {
        let xml = String::from_utf8_lossy(&bytes);
        if let Some(c) = Regex::new(r#"(?i)full-path=["']([^"']+\.opf)["']"#)
            .unwrap()
            .captures(&xml)
        {
            return Some(c[1].to_string());
        }
    }
    zip_find_name(path, |n| n.to_lowercase().ends_with(".opf"))
}

/// Значение атрибута тега (первое вхождение `name="..."` / `name='...'`).
fn attr(tag: &str, name: &str) -> Option<String> {
    Regex::new(&format!(r#"(?i)\b{}\s*=\s*["']([^"']*)["']"#, regex::escape(name)))
        .unwrap()
        .captures(tag)
        .map(|c| c[1].trim().to_string())
        .filter(|s| !s.is_empty())
}

/// MIME обложки по media-type из манифеста либо по расширению href.
fn cover_mime(media_type: Option<&str>, href: &str) -> String {
    if let Some(mt) = media_type {
        if mt.starts_with("image/") {
            return mt.to_string();
        }
    }
    let lower = href.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
    .to_string()
}

/// Объединить директорию OPF и относительный href обложки в путь внутри zip.
fn join_zip_path(opf_path: &str, href: &str) -> String {
    let dir = opf_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let mut parts: Vec<&str> = if dir.is_empty() { Vec::new() } else { dir.split('/').collect() };
    for seg in href.split('/') {
        match seg {
            "." | "" => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

/// Извлечь обложку EPUB: байты + MIME. None — если обложки нет/формат не EPUB.
pub fn extract_cover(path: &Path, ext: &str) -> Option<(Vec<u8>, String)> {
    if ext != "epub" {
        return None;
    }
    let opf_path = epub_opf(path)?;
    let opf_bytes = read_zip_entry(path, |n| n == opf_path)?;
    let opf = String::from_utf8_lossy(&opf_bytes);

    // Все элементы манифеста: id → (href, media-type).
    let item_re = Regex::new(r"(?is)<item\b[^>]*?/?>").unwrap();
    let items: Vec<(String, String, Option<String>)> = item_re
        .find_iter(&opf)
        .filter_map(|m| {
            let tag = m.as_str();
            let id = attr(tag, "id")?;
            let href = attr(tag, "href")?;
            Some((id, href, attr(tag, "media-type")))
        })
        .collect();

    // 1) <meta name="cover" content="ID"> → item с этим id.
    let cover_id = Regex::new(r#"(?is)<meta\b[^>]*\bname=["']cover["'][^>]*\bcontent=["']([^"']+)["']"#)
        .unwrap()
        .captures(&opf)
        .map(|c| c[1].to_string());
    // 2) item с properties="cover-image". 3) id содержит "cover" и это картинка.
    let pick = items
        .iter()
        .find(|(id, _, _)| Some(id) == cover_id.as_ref())
        .or_else(|| {
            item_re.find_iter(&opf).find_map(|m| {
                let tag = m.as_str();
                if attr(tag, "properties").map(|p| p.contains("cover-image")).unwrap_or(false) {
                    let href = attr(tag, "href")?;
                    items.iter().find(|(_, h, _)| *h == href)
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            items.iter().find(|(id, _, mt)| {
                id.to_lowercase().contains("cover")
                    && mt.as_deref().map(|m| m.starts_with("image/")).unwrap_or(false)
            })
        })?;

    let (_, href, media_type) = pick;
    let zip_path = join_zip_path(&opf_path, href);
    let bytes = read_zip_entry(path, |n| n == zip_path)?;
    Some((bytes, cover_mime(media_type.as_deref(), href)))
}

/// Извлечь метаданные книги по пути и расширению. Никогда не паникует.
pub fn extract(path: &Path, ext: &str) -> Meta {
    match ext {
        "epub" => {
            let opf_path = epub_opf(path);
            let bytes = read_zip_entry(path, |n| match &opf_path {
                Some(p) => n == p,
                None => n.to_lowercase().ends_with(".opf"),
            });
            bytes
                .map(|b| parse_opf(&String::from_utf8_lossy(&b)))
                .unwrap_or_default()
        }
        "fb2" => std::fs::read(path)
            .map(|b| parse_fb2(&decode_xml(&b)))
            .unwrap_or_default(),
        _ if path.to_string_lossy().to_lowercase().ends_with(".fb2.zip") => {
            read_zip_entry(path, |n| n.to_lowercase().ends_with(".fb2"))
                .map(|b| parse_fb2(&decode_xml(&b)))
                .unwrap_or_default()
        }
        _ => Meta::default(),
    }
}
