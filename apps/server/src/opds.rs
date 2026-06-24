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
pub fn dimension_list(title: &str, dim: &str, values: &[(String, i64)]) -> String {
    let mut s = String::new();
    feed_head(&mut s, title, &format!("/opds/{dim}s"));
    for (id, count) in values {
        let label = crate::autotag::label(dim, id);
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
pub fn acquisition_feed(server_name: &str, books: &[Book]) -> String {
    let mut s = String::new();
    s.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    s.push_str(
        r#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">"#,
    );
    s.push_str(&format!("<title>{}</title>", esc(server_name)));
    s.push_str("<id>urn:chitalka:catalog</id>");
    s.push_str(r#"<link rel="self" href="/opds" type="application/atom+xml;profile=opds-catalog"/>"#);
    s.push_str(r#"<link rel="start" href="/opds" type="application/atom+xml;profile=opds-catalog"/>"#);

    for b in books {
        let author = b.author.as_deref().unwrap_or("");
        s.push_str("<entry>");
        s.push_str(&format!("<title>{}</title>", esc(&b.title)));
        s.push_str(&format!("<id>urn:chitalka:book:{}</id>", esc(&b.id)));
        if !author.is_empty() {
            s.push_str(&format!("<author><name>{}</name></author>", esc(author)));
        }
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
