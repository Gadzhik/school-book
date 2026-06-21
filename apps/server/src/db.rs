//! Каталог и синхронизация в SQLite (ТЗ 4.2). Доступ синхронный под Mutex —
//! нагрузка LAN-сервера невелика, держим блокировку коротко (без .await внутри).

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::models::{
    Assignment, AssignmentReportRow, AuditEntry, Book, BookmarkSyncItem, DeviceProgress,
    HighlightSyncItem, Role, User, UserStatus, WordSyncItem,
};

/// Обёртка над соединением SQLite.
pub struct Db {
    conn: Mutex<Connection>,
}

/// Поддерживаемые расширения книг для индексации каталога.
const BOOK_EXTS: &[&str] = &["epub", "fb2", "pdf", "cbz", "mobi", "azw3"];

/// Стабильный id книги по относительному пути (для загрузки через API),
/// совпадает с тем, что использует scan_library — без дублей при пересканировании.
pub fn id_for_rel(rel: &str) -> String {
    id_for(rel)
}

/// Стабильный id книги по относительному пути (идемпотентная переиндексация).
fn id_for(rel: &str) -> String {
    let mut h = DefaultHasher::new();
    rel.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn ext_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
}

impl Db {
    /// Открыть БД и создать схему при необходимости.
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS books (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 author TEXT,
                 format TEXT NOT NULL,
                 file_path TEXT NOT NULL,
                 size INTEGER NOT NULL,
                 added_at INTEGER NOT NULL,
                 classes TEXT NOT NULL DEFAULT '',
                 subjects TEXT NOT NULL DEFAULT '',
                 categories TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE IF NOT EXISTS progress (
                 book_id TEXT NOT NULL,
                 device_id TEXT NOT NULL,
                 progress REAL NOT NULL,
                 locator TEXT,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (book_id, device_id)
             );
             CREATE TABLE IF NOT EXISTS words (
                 normalized TEXT PRIMARY KEY,
                 word TEXT NOT NULL,
                 definition TEXT,
                 updated_at INTEGER NOT NULL,
                 deleted INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS users (
                 id TEXT PRIMARY KEY,
                 role TEXT NOT NULL,
                 status TEXT NOT NULL,
                 full_name TEXT NOT NULL,
                 login TEXT NOT NULL UNIQUE,
                 pw_hash TEXT NOT NULL,
                 subjects TEXT NOT NULL DEFAULT '',
                 classes TEXT NOT NULL DEFAULT '',
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS meta (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS assignments (
                 id TEXT PRIMARY KEY,
                 book_id TEXT NOT NULL,
                 book_title TEXT NOT NULL,
                 class_id TEXT NOT NULL,
                 title TEXT NOT NULL,
                 note TEXT,
                 due_at INTEGER,
                 created_by TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS assignment_progress (
                 assignment_id TEXT NOT NULL,
                 user_id TEXT NOT NULL,
                 status TEXT NOT NULL,
                 fraction REAL NOT NULL DEFAULT 0,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (assignment_id, user_id)
             );
             CREATE TABLE IF NOT EXISTS audit (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 ts INTEGER NOT NULL,
                 actor TEXT NOT NULL,
                 action TEXT NOT NULL,
                 detail TEXT
             );
             CREATE TABLE IF NOT EXISTS bookmarks (
                 user_id TEXT NOT NULL,
                 id TEXT NOT NULL,
                 book_id TEXT NOT NULL,
                 locator TEXT NOT NULL,
                 label TEXT,
                 excerpt TEXT,
                 fraction REAL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 deleted INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (user_id, id)
             );
             CREATE TABLE IF NOT EXISTS highlights (
                 user_id TEXT NOT NULL,
                 id TEXT NOT NULL,
                 book_id TEXT NOT NULL,
                 cfi TEXT NOT NULL,
                 text TEXT NOT NULL,
                 note TEXT,
                 color TEXT,
                 fraction REAL,
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 deleted INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (user_id, id)
             );",
        )?;
        // Миграция старой БД: добавляем колонки тегов, если их нет (ошибку
        // «duplicate column» игнорируем — колонка уже есть).
        for col in ["classes", "subjects", "categories"] {
            let _ = conn.execute(
                &format!("ALTER TABLE books ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"),
                [],
            );
        }
        Ok(Db { conn: Mutex::new(conn) })
    }

    /// Просканировать каталог библиотеки и засинхронизировать таблицу books.
    /// Новые файлы добавляются, заголовок берётся из имени файла.
    pub fn scan_library(&self, root: &Path) -> rusqlite::Result<usize> {
        let mut files = Vec::new();
        collect_books(root, root, &mut files);
        let conn = self.conn.lock().unwrap();
        let now = now_ms();
        let mut added = 0usize;
        for (rel, abs, ext, size) in files {
            let id = id_for(&rel);
            let exists: bool = conn
                .query_row("SELECT 1 FROM books WHERE id=?1", params![id], |_| Ok(true))
                .unwrap_or(false);
            if exists {
                continue;
            }
            // Реальные метаданные из книги (EPUB/FB2); иначе — имя файла.
            let meta = crate::metadata::extract(&abs, &ext);
            let title = meta.title.clone().unwrap_or_else(|| title_from(&abs));
            // Автотег для OPDS-навигации по классам/предметам/категориям (5.6).
            let file_name = abs.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let tags = crate::autotag::suggest(&file_name, &title, &meta.keywords, &meta.fb2_genres);
            conn.execute(
                "INSERT INTO books
                   (id,title,author,format,file_path,size,added_at,classes,subjects,categories)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![
                    id,
                    title,
                    meta.author,
                    ext,
                    abs.to_string_lossy(),
                    size,
                    now,
                    tags.classes.join(","),
                    tags.subjects.join(","),
                    tags.categories.join(","),
                ],
            )?;
            added += 1;
        }
        Ok(added)
    }

    /// Добавить книгу в каталог (загрузка через API, ТЗ 6.5). Идемпотентно по id.
    #[allow(clippy::too_many_arguments)]
    pub fn add_book(
        &self,
        id: &str,
        title: &str,
        author: Option<&str>,
        format: &str,
        path: &str,
        size: i64,
        classes: &str,
        subjects: &str,
        categories: &str,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO books
               (id,title,author,format,file_path,size,added_at,classes,subjects,categories)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
             ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title, author=excluded.author,
                 classes=excluded.classes, subjects=excluded.subjects,
                 categories=excluded.categories",
            params![
                id,
                title,
                author,
                format,
                path,
                size,
                now_ms(),
                classes,
                subjects,
                categories,
            ],
        )?;
        Ok(())
    }

    /// Все книги каталога (для OPDS и /status).
    pub fn list_books(&self) -> rusqlite::Result<Vec<Book>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,title,author,format,size,added_at FROM books ORDER BY title COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Book {
                id: r.get(0)?,
                title: r.get(1)?,
                author: r.get(2)?,
                format: r.get(3)?,
                size: r.get(4)?,
                added_at: r.get(5)?,
            })
        })?;
        rows.collect()
    }

    /// Путь файла книги (для раздачи с Range).
    pub fn book_path(&self, id: &str) -> rusqlite::Result<Option<PathBuf>> {
        let conn = self.conn.lock().unwrap();
        let p: Option<String> = conn
            .query_row("SELECT file_path FROM books WHERE id=?1", params![id], |r| r.get(0))
            .ok();
        Ok(p.map(PathBuf::from))
    }

    pub fn count_books(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0)).unwrap_or(0)
    }

    /// Различные значения измерения с числом книг (для OPDS-навигации, 5.6).
    /// dim ∈ {"class","subject","category"}.
    pub fn distinct_tags(&self, dim: &str) -> rusqlite::Result<Vec<(String, i64)>> {
        let Some(col) = col_for(dim) else {
            return Ok(Vec::new());
        };
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!("SELECT {col} FROM books"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut counts: HashMap<String, i64> = HashMap::new();
        for csv in rows {
            for v in csv?.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                *counts.entry(v.to_string()).or_insert(0) += 1;
            }
        }
        let mut out: Vec<(String, i64)> = counts.into_iter().collect();
        if dim == "class" {
            out.sort_by_key(|(v, _)| v.parse::<i64>().unwrap_or(i64::MAX));
        } else {
            out.sort_by(|a, b| a.0.cmp(&b.0));
        }
        Ok(out)
    }

    /// Книги с данным значением измерения (для отфильтрованного OPDS-фида).
    pub fn books_by_tag(&self, dim: &str, value: &str) -> rusqlite::Result<Vec<Book>> {
        let Some(col) = col_for(dim) else {
            return Ok(Vec::new());
        };
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT id,title,author,format,size,added_at,{col} FROM books
             ORDER BY title COLLATE NOCASE"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok((
                Book {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    author: r.get(2)?,
                    format: r.get(3)?,
                    size: r.get(4)?,
                    added_at: r.get(5)?,
                },
                r.get::<_, String>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (book, csv) = row?;
            if csv.split(',').map(|s| s.trim()).any(|s| s == value) {
                out.push(book);
            }
        }
        Ok(out)
    }

    /// Самый свежий прогресс книги по всем устройствам («продолжить везде»).
    pub fn latest_progress(&self, book_id: &str) -> rusqlite::Result<Option<DeviceProgress>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT book_id,device_id,progress,locator,updated_at
             FROM progress WHERE book_id=?1 ORDER BY updated_at DESC LIMIT 1",
            params![book_id],
            |r| {
                Ok(DeviceProgress {
                    book_id: r.get(0)?,
                    device_id: r.get(1)?,
                    progress: r.get(2)?,
                    locator: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            },
        );
        match r {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Записать прогресс (LWW: обновляем только если updated_at не старее).
    pub fn upsert_progress(&self, p: &DeviceProgress) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO progress (book_id,device_id,progress,locator,updated_at)
             VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(book_id,device_id) DO UPDATE SET
                 progress=excluded.progress,
                 locator=excluded.locator,
                 updated_at=excluded.updated_at
             WHERE excluded.updated_at >= progress.updated_at",
            params![p.book_id, p.device_id, p.progress, p.locator, p.updated_at],
        )?;
        Ok(())
    }

    /// Слова, изменённые после метки since (для дельта-синхронизации).
    pub fn words_since(&self, since: i64) -> rusqlite::Result<Vec<WordSyncItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT normalized,word,definition,updated_at,deleted
             FROM words WHERE updated_at > ?1 ORDER BY updated_at",
        )?;
        let rows = stmt.query_map(params![since], |r| {
            Ok(WordSyncItem {
                normalized: r.get(0)?,
                word: r.get(1)?,
                definition: r.get(2)?,
                updated_at: r.get(3)?,
                deleted: r.get::<_, i64>(4)? != 0,
            })
        })?;
        rows.collect()
    }

    /// Принять пачку слов (LWW per normalized).
    pub fn upsert_words(&self, items: &[WordSyncItem]) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for w in items {
            tx.execute(
                "INSERT INTO words (normalized,word,definition,updated_at,deleted)
                 VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(normalized) DO UPDATE SET
                     word=excluded.word,
                     definition=excluded.definition,
                     updated_at=excluded.updated_at,
                     deleted=excluded.deleted
                 WHERE excluded.updated_at >= words.updated_at",
                params![w.normalized, w.word, w.definition, w.updated_at, w.deleted as i64],
            )?;
        }
        tx.commit()
    }

    // --- Аккаунты (ТЗ Часть 6) ---

    /// Получить секрет JWT, создав и сохранив при первом запуске.
    pub fn jwt_secret(&self) -> String {
        let conn = self.conn.lock().unwrap();
        let existing: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key='jwt_secret'", [], |r| r.get(0))
            .ok();
        if let Some(s) = existing {
            return s;
        }
        let secret = crate::auth::generate_secret();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO meta (key,value) VALUES ('jwt_secret',?1)",
            params![secret],
        );
        secret
    }

    /// Число пользователей (для бутстрапа первого администратора).
    pub fn user_count(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap_or(0)
    }

    /// Создать пользователя. Ошибка при занятом логине (UNIQUE).
    pub fn create_user(&self, u: &User) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users
               (id,role,status,full_name,login,pw_hash,subjects,classes,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                u.id,
                u.role.as_str(),
                u.status.as_str(),
                u.full_name,
                u.login,
                u.pw_hash,
                u.subjects.join(","),
                u.classes.join(","),
                u.created_at,
            ],
        )?;
        Ok(())
    }

    /// Найти пользователя по логину (для входа).
    pub fn user_by_login(&self, login: &str) -> rusqlite::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT id,role,status,full_name,login,pw_hash,subjects,classes,created_at
             FROM users WHERE login=?1",
            params![login],
            map_user,
        );
        match r {
            Ok(u) => Ok(Some(u)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Все пользователи (для экрана одобрения; фильтрация прав — в обработчике).
    pub fn list_users(&self) -> rusqlite::Result<Vec<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,role,status,full_name,login,pw_hash,subjects,classes,created_at
             FROM users ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], map_user)?;
        rows.collect()
    }

    /// Изменить статус пользователя (одобрение/блокировка). true — изменён.
    pub fn set_user_status(&self, id: &str, status: UserStatus) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE users SET status=?1 WHERE id=?2",
            params![status.as_str(), id],
        )?;
        Ok(n > 0)
    }

    /// Найти пользователя по id (для /me и middleware).
    pub fn user_by_id(&self, id: &str) -> rusqlite::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT id,role,status,full_name,login,pw_hash,subjects,classes,created_at
             FROM users WHERE id=?1",
            params![id],
            map_user,
        );
        match r {
            Ok(u) => Ok(Some(u)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Ученики класса (role=student, класс в списке classes). Для отчёта.
    pub fn students_in_class(&self, class_id: &str) -> rusqlite::Result<Vec<User>> {
        Ok(self
            .list_users()?
            .into_iter()
            .filter(|u| u.role == Role::Student && u.classes.iter().any(|c| c == class_id))
            .collect())
    }

    /// Название книги (для денормализации в задании).
    pub fn book_title(&self, id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT title FROM books WHERE id=?1", params![id], |r| r.get(0))
            .ok()
    }

    // --- Задания (ТЗ Часть 6, п.6.5) ---

    /// Создать задание.
    pub fn create_assignment(&self, a: &Assignment) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO assignments
               (id,book_id,book_title,class_id,title,note,due_at,created_by,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                a.id, a.book_id, a.book_title, a.class_id, a.title, a.note, a.due_at,
                a.created_by, a.created_at
            ],
        )?;
        Ok(())
    }

    /// Задание по id.
    pub fn assignment_by_id(&self, id: &str) -> rusqlite::Result<Option<Assignment>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT id,book_id,book_title,class_id,title,note,due_at,created_by,created_at
             FROM assignments WHERE id=?1",
            params![id],
            map_assignment,
        );
        match r {
            Ok(a) => Ok(Some(a)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Удалить задание (и связанные отметки).
    pub fn delete_assignment(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM assignment_progress WHERE assignment_id=?1", params![id])?;
        conn.execute("DELETE FROM assignments WHERE id=?1", params![id])?;
        Ok(())
    }

    /// Все задания (сортировка свежие сверху). Фильтрация — в обработчике.
    pub fn list_assignments(&self) -> rusqlite::Result<Vec<Assignment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,book_id,book_title,class_id,title,note,due_at,created_by,created_at
             FROM assignments ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], map_assignment)?;
        rows.collect()
    }

    /// Личный статус ученика по заданию: (status, fraction, updated_at).
    pub fn assignment_status_for(
        &self,
        assignment_id: &str,
        user_id: &str,
    ) -> Option<(String, f64, i64)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT status,fraction,updated_at FROM assignment_progress
             WHERE assignment_id=?1 AND user_id=?2",
            params![assignment_id, user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()
    }

    /// Записать отметку ученика по заданию (upsert).
    pub fn set_assignment_progress(
        &self,
        assignment_id: &str,
        user_id: &str,
        status: &str,
        fraction: f64,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO assignment_progress (assignment_id,user_id,status,fraction,updated_at)
             VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(assignment_id,user_id) DO UPDATE SET
                 status=excluded.status, fraction=excluded.fraction, updated_at=excluded.updated_at",
            params![assignment_id, user_id, status, fraction, now_ms()],
        )?;
        Ok(())
    }

    /// Отчёт по заданию: ученики класса + их статус (включая не начавших).
    pub fn assignment_report(&self, a: &Assignment) -> rusqlite::Result<Vec<AssignmentReportRow>> {
        let students = self.students_in_class(&a.class_id)?;
        let mut rows = Vec::new();
        for s in students {
            let st = self.assignment_status_for(&a.id, &s.id);
            rows.push(AssignmentReportRow {
                user_id: s.id.clone(),
                full_name: s.full_name.clone(),
                status: st.as_ref().map(|x| x.0.clone()).unwrap_or_else(|| "not_started".into()),
                fraction: st.as_ref().map(|x| x.1).unwrap_or(0.0),
                updated_at: st.as_ref().map(|x| x.2),
            });
        }
        Ok(rows)
    }

    // --- Аудит и бэкап (ТЗ Часть 6, E8+E9) ---

    /// Записать действие в журнал (тихо: ошибка журнала не валит операцию).
    pub fn log_audit(&self, actor: &str, action: &str, detail: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO audit (ts,actor,action,detail) VALUES (?1,?2,?3,?4)",
            params![now_ms(), actor, action, detail],
        );
    }

    /// Последние записи журнала (свежие сверху).
    pub fn recent_audit(&self, limit: i64) -> rusqlite::Result<Vec<AuditEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT ts,actor,action,detail FROM audit ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(AuditEntry {
                ts: r.get(0)?,
                actor: r.get(1)?,
                action: r.get(2)?,
                detail: r.get(3)?,
            })
        })?;
        rows.collect()
    }

    /// Сделать согласованную копию БД в файл dest (VACUUM INTO, учитывает WAL).
    pub fn backup_to(&self, dest: &Path) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy()])?;
        Ok(())
    }

    // --- Синхронизация закладок/выделений (per-user, LWW по updated_at) ---

    /// Закладки пользователя, изменённые после since.
    pub fn bookmarks_since(&self, user: &str, since: i64) -> rusqlite::Result<Vec<BookmarkSyncItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,book_id,locator,label,excerpt,fraction,created_at,updated_at,deleted
             FROM bookmarks WHERE user_id=?1 AND updated_at>?2 ORDER BY updated_at",
        )?;
        let rows = stmt.query_map(params![user, since], |r| {
            Ok(BookmarkSyncItem {
                id: r.get(0)?,
                book_id: r.get(1)?,
                locator: r.get(2)?,
                label: r.get(3)?,
                excerpt: r.get(4)?,
                fraction: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                deleted: r.get::<_, i64>(8)? != 0,
            })
        })?;
        rows.collect()
    }

    /// Принять пачку закладок пользователя (LWW по updated_at, ключ id).
    pub fn upsert_bookmarks(&self, user: &str, items: &[BookmarkSyncItem]) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for b in items {
            tx.execute(
                "INSERT INTO bookmarks
                   (user_id,id,book_id,locator,label,excerpt,fraction,created_at,updated_at,deleted)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(user_id,id) DO UPDATE SET
                     book_id=excluded.book_id, locator=excluded.locator, label=excluded.label,
                     excerpt=excluded.excerpt, fraction=excluded.fraction,
                     updated_at=excluded.updated_at, deleted=excluded.deleted
                 WHERE excluded.updated_at >= bookmarks.updated_at",
                params![
                    user, b.id, b.book_id, b.locator, b.label, b.excerpt, b.fraction,
                    b.created_at, b.updated_at, b.deleted as i64
                ],
            )?;
        }
        tx.commit()
    }

    /// Выделения пользователя, изменённые после since.
    pub fn highlights_since(&self, user: &str, since: i64) -> rusqlite::Result<Vec<HighlightSyncItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,book_id,cfi,text,note,color,fraction,created_at,updated_at,deleted
             FROM highlights WHERE user_id=?1 AND updated_at>?2 ORDER BY updated_at",
        )?;
        let rows = stmt.query_map(params![user, since], |r| {
            Ok(HighlightSyncItem {
                id: r.get(0)?,
                book_id: r.get(1)?,
                cfi: r.get(2)?,
                text: r.get(3)?,
                note: r.get(4)?,
                color: r.get(5)?,
                fraction: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
                deleted: r.get::<_, i64>(9)? != 0,
            })
        })?;
        rows.collect()
    }

    /// Принять пачку выделений пользователя (LWW по updated_at, ключ id).
    pub fn upsert_highlights(&self, user: &str, items: &[HighlightSyncItem]) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for h in items {
            tx.execute(
                "INSERT INTO highlights
                   (user_id,id,book_id,cfi,text,note,color,fraction,created_at,updated_at,deleted)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
                 ON CONFLICT(user_id,id) DO UPDATE SET
                     book_id=excluded.book_id, cfi=excluded.cfi, text=excluded.text,
                     note=excluded.note, color=excluded.color, fraction=excluded.fraction,
                     updated_at=excluded.updated_at, deleted=excluded.deleted
                 WHERE excluded.updated_at >= highlights.updated_at",
                params![
                    user, h.id, h.book_id, h.cfi, h.text, h.note, h.color, h.fraction,
                    h.created_at, h.updated_at, h.deleted as i64
                ],
            )?;
        }
        tx.commit()
    }
}

/// Разобрать строку таблицы assignments.
fn map_assignment(r: &rusqlite::Row) -> rusqlite::Result<Assignment> {
    Ok(Assignment {
        id: r.get(0)?,
        book_id: r.get(1)?,
        book_title: r.get(2)?,
        class_id: r.get(3)?,
        title: r.get(4)?,
        note: r.get(5)?,
        due_at: r.get(6)?,
        created_by: r.get(7)?,
        created_at: r.get(8)?,
    })
}

/// Разобрать строку таблицы users в модель User.
fn map_user(r: &rusqlite::Row) -> rusqlite::Result<User> {
    let split = |s: String| -> Vec<String> {
        s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
    };
    Ok(User {
        id: r.get(0)?,
        role: Role::from_str(&r.get::<_, String>(1)?).unwrap_or(Role::Student),
        status: UserStatus::from_str(&r.get::<_, String>(2)?),
        full_name: r.get(3)?,
        login: r.get(4)?,
        pw_hash: r.get(5)?,
        subjects: split(r.get::<_, String>(6)?),
        classes: split(r.get::<_, String>(7)?),
        created_at: r.get(8)?,
    })
}

/// Имя колонки таблицы books по имени измерения OPDS.
fn col_for(dim: &str) -> Option<&'static str> {
    match dim {
        "class" => Some("classes"),
        "subject" => Some("subjects"),
        "category" => Some("categories"),
        _ => None,
    }
}

/// Рекурсивно собрать книги: (rel_path, abs_path, ext, size).
fn collect_books(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf, String, i64)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        if path.is_dir() {
            collect_books(root, &path, out);
        } else if let Some(ext) = ext_of(&path) {
            if BOOK_EXTS.contains(&ext.as_str()) {
                let size = e.metadata().map(|m| m.len() as i64).unwrap_or(0);
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                out.push((rel, path, ext, size));
            }
        }
    }
}

fn title_from(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Книга")
        .trim()
        .to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{BookmarkSyncItem, Role, User, UserStatus};

    fn mem_db() -> Db {
        Db::open(Path::new(":memory:")).unwrap()
    }

    fn mk_user(id: &str, login: &str, role: Role, classes: &[&str]) -> User {
        User {
            id: id.into(),
            role,
            status: UserStatus::Active,
            full_name: login.into(),
            login: login.into(),
            pw_hash: "x".into(),
            subjects: vec![],
            classes: classes.iter().map(|s| s.to_string()).collect(),
            created_at: 0,
        }
    }

    #[test]
    fn users_create_find_status() {
        let db = mem_db();
        db.create_user(&mk_user("u1", "ivan", Role::Student, &["7"])).unwrap();
        assert!(db.create_user(&mk_user("u2", "ivan", Role::Student, &[])).is_err()); // login UNIQUE
        let got = db.user_by_login("ivan").unwrap().unwrap();
        assert_eq!(got.id, "u1");
        assert_eq!(got.classes, vec!["7".to_string()]);
        assert!(db.set_user_status("u1", UserStatus::Blocked).unwrap());
        assert_eq!(db.user_by_id("u1").unwrap().unwrap().status, UserStatus::Blocked);
    }

    #[test]
    fn students_in_class_filters() {
        let db = mem_db();
        db.create_user(&mk_user("s7", "s7", Role::Student, &["7"])).unwrap();
        db.create_user(&mk_user("s8", "s8", Role::Student, &["8"])).unwrap();
        db.create_user(&mk_user("t", "t", Role::Teacher, &["7"])).unwrap();
        let in7 = db.students_in_class("7").unwrap();
        assert_eq!(in7.len(), 1);
        assert_eq!(in7[0].id, "s7");
    }

    fn bm(id: &str, label: &str, updated: i64) -> BookmarkSyncItem {
        BookmarkSyncItem {
            id: id.into(),
            book_id: "b1".into(),
            locator: "cfi/2".into(),
            label: Some(label.into()),
            excerpt: None,
            fraction: Some(0.1),
            created_at: 1000,
            updated_at: updated,
            deleted: false,
        }
    }

    #[test]
    fn bookmarks_lww_and_isolation() {
        let db = mem_db();
        db.upsert_bookmarks("u1", &[bm("bm1", "новое", 2000)]).unwrap();
        // Старая версия не перезаписывает.
        db.upsert_bookmarks("u1", &[bm("bm1", "старое", 1000)]).unwrap();
        let items = db.bookmarks_since("u1", 0).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].label.as_deref(), Some("новое"));
        // Другой пользователь не видит чужие закладки.
        assert_eq!(db.bookmarks_since("u2", 0).unwrap().len(), 0);
    }
}
