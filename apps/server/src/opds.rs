//! Построение OPDS-каталога (Atom, ТЗ 4.4). Совместим со сторонними
//! читалками (Foliate/KOReader) и нашим клиентом @reader/network.
//! XML собираем строками — без тяжёлых зависимостей.

use crate::models::Book;

/// MIME-тип скачиваемого файла по формату (для link rel=acquisition).
fn mime_for(format: &str) -> &'static str {
    match format {
        "epub" => "application/epub+zip",
        "fb2" => "application/x-fictionbook+xml",
        "pdf" => "application/pdf",
        "cbz" => "application/x-cbz",
        "mobi" => "application/x-mobipocket-ebook",
        "azw3" => "application/vnd.amazon.ebook",
        _ => "application/octet-stream",
    }
}

/// Экранировать спецсимволы XML.
fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

const NAV_TYPE: &str = "application/atom+xml;profile=opds-catalog;kind=navigation";
const ACQ_TYPE: &str = "application/atom+xml;profile=opds-catalog;kind=acquisition";

/// Книга каталога вместе с тегами — для выдачи `<category>` в acquisition-фиде.
/// Без тегов в фиде скачанная книга приходит на устройство «голой», и фасетный
/// фильтр библиотеки (класс/предмет/категория) её не находит.
pub struct FeedBook<'a> {
    pub book: &'a Book,
    pub classes: &'a [String],
    pub subjects: &'a [String],
    pub categories: &'a [String],
}

/// Схема Atom-категории по измерению (по ней клиент раскладывает теги).
fn scheme_for(dim: &str) -> String {
    format!("urn:chitalka:{dim}")
}

/// Как получить подпись тега: словарь школы из БД, с фолбэком на встроенный
/// набор. Передаётся снаружи, чтобы этот модуль не лез в состояние сервера.
pub type LabelFn<'a> = &'a dyn Fn(&str, &str) -> String;

/// Вывести `<category>` для одного измерения книги.
fn categories_of(s: &mut String, dim: &str, values: &[String], label: LabelFn<'_>) {
    for v in values {
        s.push_str(&format!(
            r#"<category scheme="{}" term="{}" label="{}"/>"#,
            esc(&scheme_for(dim)),
            esc(v),
            esc(&label(dim, v))
        ));
    }
}

fn feed_head(s: &mut String, title: &str, self_href: &str) {
    s.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    s.push_str(
        r#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">"#,
    );
    s.push_str(&format!("<title>{}</title>", esc(title)));
    s.push_str(&format!("<id>urn:chitalka:{}</id>", esc(self_href)));
    s.push_str(&format!(r#"<link rel="self" href="{}" type="{}"/>"#, esc(self_href), NAV_TYPE));
    s.push_str(&format!(r#"<link rel="start" href="/opds" type="{}"/>"#, NAV_TYPE));
}

fn nav_entry(s: &mut String, title: &str, href: &str, kind_type: &str) {
    s.push_str("<entry>");
    s.push_str(&format!("<title>{}</title>", esc(title)));
    s.push_str(&format!("<id>urn:chitalka:nav:{}</id>", esc(href)));
    s.push_str(&format!(r#"<link rel="subsection" href="{}" type="{}"/>"#, esc(href), kind_type));
    s.push_str("</entry>");
}

/// Корневой навигационный фид: все книги + навигация по измерениям (ТЗ 5.6).
/// `show_mine` — добавить пункт «Мои книги» (для тех, кто загружает контент).
pub fn navigation_root(server_name: &str, show_mine: bool) -> String {
    let mut s = String::new();
    feed_head(&mut s, server_name, "/opds");
    nav_entry(&mut s, "Все книги", "/opds/all", ACQ_TYPE);
    if show_mine {
        nav_entry(&mut s, "Мои книги", "/opds/mine", ACQ_TYPE);
    }
    nav_entry(&mut s, "По классам", "/opds/classes", NAV_TYPE);
    nav_entry(&mut s, "По предметам", "/opds/subjects", NAV_TYPE);
    nav_entry(&mut s, "По категориям", "/opds/categories", NAV_TYPE);
    s.push_str("</feed>");
    s
}

/// Навигационный фид со значениями измерения (классы/предметы/категории).
/// dim ∈ {"class","subject","category"}; values — (id, число книг).
pub fn dimension_list(title: &str, dim: &str, values: &[(String, i64)], label: LabelFn<'_>) -> String {
    let mut s = String::new();
    feed_head(&mut s, title, &format!("/opds/{dim}s"));
    for (id, count) in values {
        let label = label(dim, id);
        nav_entry(
            &mut s,
            &format!("{label} ({count})"),
            &format!("/opds/{dim}/{id}"),
            ACQ_TYPE,
        );
    }
    s.push_str("</feed>");
    s
}

/// Корневой acquisition-фид: все книги каталога со ссылками на скачивание.
pub fn acquisition_feed(server_name: &str, books: &[FeedBook<'_>], label: LabelFn<'_>) -> String {
    let mut s = String::new();
    s.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    s.push_str(
        r#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">"#,
    );
    s.push_str(&format!("<title>{}</title>", esc(server_name)));
    s.push_str("<id>urn:chitalka:catalog</id>");
    s.push_str(r#"<link rel="self" href="/opds" type="application/atom+xml;profile=opds-catalog"/>"#);
    s.push_str(r#"<link rel="start" href="/opds" type="application/atom+xml;profile=opds-catalog"/>"#);

    for fb in books {
        let b = fb.book;
        let author = b.author.as_deref().unwrap_or("");
        s.push_str("<entry>");
        s.push_str(&format!("<title>{}</title>", esc(&b.title)));
        s.push_str(&format!("<id>urn:chitalka:book:{}</id>", esc(&b.id)));
        if !author.is_empty() {
            s.push_str(&format!("<author><name>{}</name></author>", esc(author)));
        }
        // Теги книги — чтобы скачавшее устройство сохранило класс/предмет.
        categories_of(&mut s, "class", fb.classes, label);
        categories_of(&mut s, "subject", fb.subjects, label);
        categories_of(&mut s, "category", fb.categories, label);
        s.push_str(&format!(
            r#"<link rel="http://opds-spec.org/acquisition" href="/books/{}/file" type="{}"/>"#,
            esc(&b.id),
            mime_for(&b.format)
        ));
        // Обложка (только EPUB — для прочих эндпоинт вернёт 404).
        if b.format == "epub" {
            s.push_str(&format!(
                r#"<link rel="http://opds-spec.org/image" href="/books/{0}/cover" type="image/jpeg"/>"#,
                esc(&b.id)
            ));
            s.push_str(&format!(
                r#"<link rel="http://opds-spec.org/image/thumbnail" href="/books/{0}/cover" type="image/jpeg"/>"#,
                esc(&b.id)
            ));
        }
        s.push_str("</entry>");
    }

    s.push_str("</feed>");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book() -> Book {
        Book {
            id: "b1".into(),
            title: "Информатика 9".into(),
            author: Some("Автор".into()),
            format: "epub".into(),
            size: 10,
            added_at: 0,
        }
    }

    /// Теги книги обязаны попадать в фид: по ним клиент проставляет класс/
    /// предмет скачанной книге, иначе фасетный фильтр её не находит.
    #[test]
    fn acquisition_feed_emits_tags() {
        let b = book();
        let classes = vec!["9".to_string()];
        let subjects = vec!["informatics".to_string()];
        let none: Vec<String> = vec![];
        let xml = acquisition_feed(
            "Сервер",
            &[FeedBook { book: &b, classes: &classes, subjects: &subjects, categories: &none }],
            &crate::autotag::label,
        );
        assert!(xml.contains(r#"<category scheme="urn:chitalka:class" term="9""#), "{xml}");
        assert!(
            xml.contains(r#"<category scheme="urn:chitalka:subject" term="informatics""#),
            "{xml}"
        );
        assert!(!xml.contains("urn:chitalka:category"), "пустое измерение не выводим: {xml}");
    }

    /// Книга без тегов — фид как раньше, без <category>.
    #[test]
    fn acquisition_feed_without_tags() {
        let b = book();
        let none: Vec<String> = vec![];
        let xml = acquisition_feed(
            "Сервер",
            &[FeedBook { book: &b, classes: &none, subjects: &none, categories: &none }],
            &crate::autotag::label,
        );
        assert!(!xml.contains("<category"), "{xml}");
    }
}
