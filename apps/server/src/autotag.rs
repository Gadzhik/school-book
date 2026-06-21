//! Серверная авторазметка книг (ТЗ 5.4, 5.6): по имени файла, заголовку и
//! метаданным определяем класс/предмет/категорию для OPDS-навигации по
//! измерениям. Зеркалит клиентский `packages/core/src/autotag.ts`.

use regex::Regex;
use std::sync::OnceLock;

/// Предложенные теги (id из управляемой таксономии, см. taxonomy ниже).
#[derive(Debug, Default)]
pub struct Tags {
    pub classes: Vec<String>,
    pub subjects: Vec<String>,
    pub categories: Vec<String>,
}

/// Стемы названий предметов → id (порядок важен: алгебра до математики).
const SUBJECT_STEMS: &[(&str, &[&str])] = &[
    ("russian", &["русск"]),
    ("literature", &["литератур", "чтение"]),
    ("algebra", &["алгебр"]),
    ("geometry", &["геометр"]),
    ("math", &["математик"]),
    ("informatics", &["информатик", "программир"]),
    ("physics", &["физик"]),
    ("chemistry", &["хими"]),
    ("biology", &["биолог"]),
    ("geography", &["географ"]),
    ("history", &["истори"]),
    ("social", &["обществозн", "общество"]),
    ("foreign", &["английск", "немецк", "французск", "иностранн"]),
    ("world", &["окружающ"]),
    ("astronomy", &["астроном"]),
    ("art", &["изобразит", "рисован"]),
    ("music", &["музык"]),
    ("technology", &["технолог"]),
    ("safety", &["обж", "безопасност"]),
    ("pe", &["физкультур", "физическ"]),
];

/// Стемы названий категорий → id.
const CATEGORY_STEMS: &[(&str, &[&str])] = &[
    ("workbook", &["рабочая тетрад", "тетрадь"]),
    ("textbook", &["учебник"]),
    ("manual", &["пособие", "практикум"]),
    ("reader", &["хрестомат"]),
    ("reference", &["словар", "справочник", "энциклопед"]),
    ("atlas", &["атлас"]),
    ("comic", &["комикс", "манга"]),
    ("extracurricular", &["внеклассн"]),
];

/// Коды жанров FB2 → id предмета.
const FB2_GENRE_SUBJECT: &[(&str, &str)] = &[
    ("sci_phys", "physics"),
    ("sci_math", "math"),
    ("sci_chem", "chemistry"),
    ("sci_biology", "biology"),
    ("sci_medicine", "biology"),
    ("sci_history", "history"),
    ("sci_geo", "geography"),
    ("geo_guides", "geography"),
    ("sci_politics", "social"),
    ("sci_juris", "social"),
    ("sci_economy", "social"),
    ("sci_linguistic", "russian"),
    ("sci_philology", "literature"),
    ("sci_tech", "technology"),
    ("sci_cybernetics", "informatics"),
    ("comp_programming", "informatics"),
    ("comp_hard", "informatics"),
    ("comp_soft", "informatics"),
    ("comp_db", "informatics"),
    ("comp_www", "informatics"),
    ("computers", "informatics"),
    ("foreign_language", "foreign"),
];

/// Коды жанров FB2 → id категории.
const FB2_GENRE_CATEGORY: &[(&str, &str)] = &[
    ("science", "popsci"),
    ("sci_popular", "popsci"),
    ("reference", "reference"),
    ("dictionaries", "reference"),
    ("ref_encyc", "reference"),
    ("ref_dict", "reference"),
    ("comics", "comic"),
];

const FB2_FICTION_PREFIXES: &[&str] = &[
    "prose", "poetry", "dramaturgy", "sf", "det_", "love_", "adv_", "thriller", "antique",
    "children", "child_", "fairy", "humor",
];

fn normalize(s: &str) -> String {
    s.to_lowercase().replace('ё', "е")
}

fn class_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(\d{1,2})\s*(?:-\s*(\d{1,2}))?\s*(?:класс|кл\b|кл\.)").unwrap())
}

fn push_unique(v: &mut Vec<String>, s: &str) {
    if !v.iter().any(|x| x == s) {
        v.push(s.to_string());
    }
}

/// Предложить теги по имени файла, заголовку и метаданным книги.
pub fn suggest(file_name: &str, title: &str, keywords: &[String], fb2_genres: &[String]) -> Tags {
    let hay = normalize(&format!("{} {} {}", file_name, title, keywords.join(" ")));
    let mut tags = Tags::default();

    // Классы: «7 класс», «5-6 класс», «9 кл.».
    for cap in class_regex().captures_iter(&hay) {
        let a: u32 = cap[1].parse().unwrap_or(0);
        let b: u32 = cap.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(a);
        for c in a.min(b)..=a.max(b) {
            if (1..=11).contains(&c) {
                push_unique(&mut tags.classes, &c.to_string());
            }
        }
    }

    for (id, stems) in SUBJECT_STEMS {
        if stems.iter().any(|k| hay.contains(k)) {
            push_unique(&mut tags.subjects, id);
        }
    }
    for (id, stems) in CATEGORY_STEMS {
        if stems.iter().any(|k| hay.contains(k)) {
            push_unique(&mut tags.categories, id);
        }
    }

    // Коды жанров FB2 — точнее текстовых эвристик.
    for raw in fb2_genres {
        let g = raw.trim().to_lowercase();
        if g.is_empty() {
            continue;
        }
        if let Some((_, id)) = FB2_GENRE_SUBJECT.iter().find(|(k, _)| *k == g) {
            push_unique(&mut tags.subjects, id);
        }
        if let Some((_, id)) = FB2_GENRE_CATEGORY.iter().find(|(k, _)| *k == g) {
            push_unique(&mut tags.categories, id);
        }
        if FB2_FICTION_PREFIXES.iter().any(|p| g.starts_with(p)) {
            push_unique(&mut tags.categories, "fiction");
        }
    }

    tags
}

// --- Подписи таксономии для OPDS-навигации (ТЗ 5.3) ---

const SUBJECT_LABELS: &[(&str, &str)] = &[
    ("russian", "Русский язык"),
    ("literature", "Литература"),
    ("math", "Математика"),
    ("algebra", "Алгебра"),
    ("geometry", "Геометрия"),
    ("informatics", "Информатика"),
    ("physics", "Физика"),
    ("chemistry", "Химия"),
    ("biology", "Биология"),
    ("geography", "География"),
    ("history", "История"),
    ("social", "Обществознание"),
    ("foreign", "Иностранный язык"),
    ("world", "Окружающий мир"),
    ("astronomy", "Астрономия"),
    ("art", "ИЗО"),
    ("music", "Музыка"),
    ("technology", "Технология"),
    ("safety", "ОБЖ"),
    ("pe", "Физическая культура"),
];

const CATEGORY_LABELS: &[(&str, &str)] = &[
    ("textbook", "Учебник"),
    ("manual", "Пособие"),
    ("workbook", "Рабочая тетрадь"),
    ("reader", "Хрестоматия"),
    ("fiction", "Художественная"),
    ("popsci", "Научпоп"),
    ("reference", "Справочник/словарь"),
    ("atlas", "Атлас"),
    ("comic", "Комикс"),
    ("extracurricular", "Внеклассное чтение"),
];

/// Подпись измерения по id (классы — «N класс», иначе из словаря; фолбэк — id).
pub fn label(dimension: &str, id: &str) -> String {
    match dimension {
        "class" => format!("{id} класс"),
        "subject" => SUBJECT_LABELS
            .iter()
            .find(|(k, _)| *k == id)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| id.to_string()),
        "category" => CATEGORY_LABELS
            .iter()
            .find(|(k, _)| *k == id)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| id.to_string()),
        _ => id.to_string(),
    }
}
