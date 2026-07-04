//! Каталог и синхронизация в SQLite (ТЗ 4.2). Доступ синхронный под Mutex —
//! нагрузка LAN-сервера невелика, держим блокировку коротко (без .await внутри).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::models::{
    Assignment, AssignmentReportRow, AuditEntry, Book, BookmarkSyncItem, ClassNote,
    DeviceProgress, HighlightSyncItem, Quiz, QuizQuestion, QuizResultRow, Role, User,
    UserStatus, WordSyncItem,
};

/// Обёртка над соединением SQLite.
pub struct Db {
    conn: Mutex<Connection>,
}

/// Книга с данными доступа (для фильтрации каталога по правам — ТЗ 6.5).
pub struct BookAccess {
    pub book: Book,
    pub classes: Vec<String>,
    pub subjects: Vec<String>,
    pub categories: Vec<String>,
    /// «Доступна всем» — видна любому активному пользователю.
    pub public: bool,
    /// id загрузившего (None — книга из папки/скана).
    pub owner_id: Option<String>,
}

/// Разбить CSV-строку тегов в вектор (без пустых, с тримом).
fn split_csv(s: &str) -> Vec<String> {
    s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
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
                 categories TEXT NOT NULL DEFAULT '',
                 public INTEGER NOT NULL DEFAULT 0,
                 owner_id TEXT
             );
             CREATE TABLE IF NOT EXISTS progress (
                 user_id TEXT NOT NULL DEFAULT '',
                 book_id TEXT NOT NULL,
                 device_id TEXT NOT NULL,
                 progress REAL NOT NULL,
                 locator TEXT,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (user_id, book_id, device_id)
             );
             CREATE TABLE IF NOT EXISTS words (
                 user_id TEXT NOT NULL DEFAULT '',
                 normalized TEXT NOT NULL,
                 word TEXT NOT NULL,
                 definition TEXT,
                 updated_at INTEGER NOT NULL,
                 deleted INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (user_id, normalized)
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
             );
             CREATE TABLE IF NOT EXISTS class_notes (
                 id TEXT PRIMARY KEY,
                 book_id TEXT NOT NULL,
                 class_id TEXT NOT NULL,
                 cfi TEXT NOT NULL,
                 text TEXT NOT NULL,
                 note TEXT,
                 color TEXT,
                 created_by TEXT NOT NULL,
                 author_name TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS quizzes (
                 id TEXT PRIMARY KEY,
                 book_id TEXT NOT NULL DEFAULT '',
                 book_title TEXT NOT NULL DEFAULT '',
                 class_id TEXT NOT NULL,
                 title TEXT NOT NULL,
                 questions TEXT NOT NULL,
                 created_by TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS quiz_results (
                 quiz_id TEXT NOT NULL,
                 user_id TEXT NOT NULL,
                 score INTEGER NOT NULL,
                 total INTEGER NOT NULL,
                 answers TEXT NOT NULL,
                 updated_at INTEGER NOT NULL,
                 PRIMARY KEY (quiz_id, user_id)
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
        // Колонки доступа (ТЗ 6.5): public — «доступна всем», owner_id — кто
        // загрузил. public особый: если колонки не было, помечаем все уже
        // существующие книги public=1, чтобы не сломать текущий доступ (раньше
        // каталог отдавал всё всем). Новые книги приватны (public=0) — доступ
        // задаётся явно классом/предметом или флагом «доступна всем».
        let has_public: bool = conn
            .query_row(
                "SELECT 1 FROM pragma_table_info('books') WHERE name='public'",
                [],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !has_public {
            conn.execute(
                "ALTER TABLE books ADD COLUMN public INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
            conn.execute("UPDATE books SET public=1", [])?;
        }
        let _ = conn.execute("ALTER TABLE books ADD COLUMN owner_id TEXT", []);
        // Миграция синка на аккаунты (Часть 6): в progress/words добавился
        // user_id (вошёл в PRIMARY KEY). SQLite не меняет PK через ALTER —
        // перестраиваем таблицу. Старые строки получают user_id='' —
        // legacy-скоуп клиентов без аккаунта (их поведение не меняется).
        let has_col = |table: &str, col: &str| -> bool {
            conn.query_row(
                &format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name='{col}'"),
                [],
                |_| Ok(true),
            )
            .unwrap_or(false)
        };
        if !has_col("progress", "user_id") {
            conn.execute_batch(
                "ALTER TABLE progress RENAME TO progress_old;
                 CREATE TABLE progress (
                     user_id TEXT NOT NULL DEFAULT '',
                     book_id TEXT NOT NULL,
                     device_id TEXT NOT NULL,
                     progress REAL NOT NULL,
                     locator TEXT,
                     updated_at INTEGER NOT NULL,
                     PRIMARY KEY (user_id, book_id, device_id)
                 );
                 INSERT INTO progress (user_id,book_id,device_id,progress,locator,updated_at)
                     SELECT '',book_id,device_id,progress,locator,updated_at FROM progress_old;
                 DROP TABLE progress_old;",
            )?;
        }
        if !has_col("words", "user_id") {
            conn.execute_batch(
                "ALTER TABLE words RENAME TO words_old;
                 CREATE TABLE words (
                     user_id TEXT NOT NULL DEFAULT '',
                     normalized TEXT NOT NULL,
                     word TEXT NOT NULL,
                     definition TEXT,
                     updated_at INTEGER NOT NULL,
                     deleted INTEGER NOT NULL DEFAULT 0,
                     PRIMARY KEY (user_id, normalized)
                 );
                 INSERT INTO words (user_id,normalized,word,definition,updated_at,deleted)
                     SELECT '',normalized,word,definition,updated_at,deleted FROM words_old;
                 DROP TABLE words_old;",
            )?;
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
            // Книги, найденные в папке библиотеки (положены админом на сервер
            // напрямую), считаем доступными всем — без регрессии прежнего
            // поведения. Загрузка через приложение — приватна по умолчанию.
            conn.execute(
                "INSERT INTO books
                   (id,title,author,format,file_path,size,added_at,classes,subjects,categories,public,owner_id)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,NULL)",
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
    /// `public` — «доступна всем»; `owner_id` — кто загрузил (для «Мои книги»
    /// и доступа загрузившему даже без тегов).
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
        public: bool,
        owner_id: Option<&str>,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO books
               (id,title,author,format,file_path,size,added_at,classes,subjects,categories,public,owner_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title, author=excluded.author,
                 classes=excluded.classes, subjects=excluded.subjects,
                 categories=excluded.categories, public=excluded.public,
                 owner_id=excluded.owner_id",
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
                public as i64,
                owner_id,
            ],
        )?;
        Ok(())
    }

    /// Обновить теги/доступ книги (публикация локальной книги на сервер с уже
    /// проставленными тегами — без повторной загрузки файла). true — обновлено.
    /// Владелец книги (owner_id загрузившего). Ok(None) — книги нет;
    /// Ok(Some(None)) — книга без владельца (положена в папку напрямую).
    pub fn book_owner(&self, id: &str) -> rusqlite::Result<Option<Option<String>>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT owner_id FROM books WHERE id=?1",
            params![id],
            |r| r.get::<_, Option<String>>(0),
        );
        match r {
            Ok(o) => Ok(Some(o)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Путь к файлу и владелец книги (для снятия с публикации).
    pub fn book_path_owner(&self, id: &str) -> rusqlite::Result<Option<(String, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT file_path, owner_id FROM books WHERE id=?1",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Удалить книгу из каталога (снятие с публикации). true — была и удалена.
    pub fn delete_book(&self, id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM books WHERE id=?1", params![id])?;
        Ok(n > 0)
    }

    pub fn update_book_tags(
        &self,
        id: &str,
        classes: &str,
        subjects: &str,
        categories: &str,
        public: bool,
    ) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE books SET classes=?2, subjects=?3, categories=?4, public=?5 WHERE id=?1",
            params![id, classes, subjects, categories, public as i64],
        )?;
        Ok(n > 0)
    }

    /// Все книги каталога вместе с данными доступа (теги/public/владелец).
    /// Фильтрация по правам пользователя — в обработчиках (lib.rs::can_see).
    pub fn all_books_access(&self) -> rusqlite::Result<Vec<BookAccess>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,title,author,format,size,added_at,classes,subjects,categories,public,owner_id
             FROM books ORDER BY title COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(BookAccess {
                book: Book {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    author: r.get(2)?,
                    format: r.get(3)?,
                    size: r.get(4)?,
                    added_at: r.get(5)?,
                },
                classes: split_csv(&r.get::<_, String>(6)?),
                subjects: split_csv(&r.get::<_, String>(7)?),
                categories: split_csv(&r.get::<_, String>(8)?),
                public: r.get::<_, i64>(9)? != 0,
                owner_id: r.get(10)?,
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

    /// Самый свежий прогресс книги по всем устройствам АККАУНТА
    /// («продолжить везде», Часть 6). user_id='' — legacy-скоуп без аккаунта.
    pub fn latest_progress(
        &self,
        user_id: &str,
        book_id: &str,
    ) -> rusqlite::Result<Option<DeviceProgress>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT user_id,book_id,device_id,progress,locator,updated_at
             FROM progress WHERE user_id=?1 AND book_id=?2
             ORDER BY updated_at DESC LIMIT 1",
            params![user_id, book_id],
            |r| {
                let uid: String = r.get(0)?;
                Ok(DeviceProgress {
                    user_id: if uid.is_empty() { None } else { Some(uid) },
                    book_id: r.get(1)?,
                    device_id: r.get(2)?,
                    progress: r.get(3)?,
                    locator: r.get(4)?,
                    updated_at: r.get(5)?,
                })
            },
        );
        match r {
            Ok(p) => Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Записать прогресс аккаунта (LWW: обновляем только если updated_at не старее).
    pub fn upsert_progress(&self, user_id: &str, p: &DeviceProgress) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO progress (user_id,book_id,device_id,progress,locator,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(user_id,book_id,device_id) DO UPDATE SET
                 progress=excluded.progress,
                 locator=excluded.locator,
                 updated_at=excluded.updated_at
             WHERE excluded.updated_at >= progress.updated_at",
            params![user_id, p.book_id, p.device_id, p.progress, p.locator, p.updated_at],
        )?;
        Ok(())
    }

    /// Слова аккаунта, изменённые после метки since (дельта-синхронизация).
    pub fn words_since(&self, user_id: &str, since: i64) -> rusqlite::Result<Vec<WordSyncItem>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT normalized,word,definition,updated_at,deleted
             FROM words WHERE user_id=?1 AND updated_at > ?2 ORDER BY updated_at",
        )?;
        let rows = stmt.query_map(params![user_id, since], |r| {
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

    /// Принять пачку слов аккаунта (LWW per normalized).
    pub fn upsert_words(&self, user_id: &str, items: &[WordSyncItem]) -> rusqlite::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for w in items {
            tx.execute(
                "INSERT INTO words (user_id,normalized,word,definition,updated_at,deleted)
                 VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(user_id,normalized) DO UPDATE SET
                     word=excluded.word,
                     definition=excluded.definition,
                     updated_at=excluded.updated_at,
                     deleted=excluded.deleted
                 WHERE excluded.updated_at >= words.updated_at",
                params![user_id, w.normalized, w.word, w.definition, w.updated_at, w.deleted as i64],
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

    /// Сменить роль пользователя (управление из админки).
    pub fn set_user_role(&self, id: &str, role: Role) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE users SET role=?1 WHERE id=?2",
            params![role.as_str(), id],
        )?;
        Ok(n > 0)
    }

    /// Удалить пользователя (управление из админки).
    pub fn delete_user(&self, id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM users WHERE id=?1", params![id])?;
        Ok(n > 0)
    }

    /// Число активных администраторов (для гарантии «админ всегда есть»).
    pub fn active_admin_count(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role='admin' AND status='active'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }

    /// Сменить хэш пароля пользователя (смена своего / сброс админом).
    pub fn set_user_password(&self, id: &str, pw_hash: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE users SET pw_hash=?1 WHERE id=?2",
            params![pw_hash, id],
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

    // --- Панель класса: сводный прогресс (E2) ---

    /// Последние позиции чтения пользователя по каждой книге (максимум по
    /// updated_at среди устройств). (book_id, fraction, updated_at).
    pub fn user_progress_latest(&self, user_id: &str) -> rusqlite::Result<Vec<(String, f64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT book_id, progress, MAX(updated_at) FROM progress
             WHERE user_id=?1 GROUP BY book_id",
        )?;
        let rows = stmt.query_map(params![user_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)?))
        })?;
        rows.collect()
    }

    // --- Заметки учителя, видимые классу ---

    pub fn create_class_note(&self, n: &ClassNote) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO class_notes
               (id,book_id,class_id,cfi,text,note,color,created_by,author_name,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                n.id, n.book_id, n.class_id, n.cfi, n.text, n.note, n.color, n.created_by,
                n.author_name, n.updated_at
            ],
        )?;
        Ok(())
    }

    /// Все заметки по книге (фильтрация по правам — в хендлере).
    pub fn class_notes_by_book(&self, book_id: &str) -> rusqlite::Result<Vec<ClassNote>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,book_id,class_id,cfi,text,note,color,created_by,author_name,updated_at
             FROM class_notes WHERE book_id=?1 ORDER BY updated_at",
        )?;
        let rows = stmt.query_map(params![book_id], map_class_note)?;
        rows.collect()
    }

    pub fn class_note_by_id(&self, id: &str) -> rusqlite::Result<Option<ClassNote>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT id,book_id,class_id,cfi,text,note,color,created_by,author_name,updated_at
             FROM class_notes WHERE id=?1",
            params![id],
            map_class_note,
        );
        match r {
            Ok(n) => Ok(Some(n)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Удалить заметку (вместе с дублями той же публикации в других классах —
    /// по совпадению created_by+book_id+cfi, чтобы «убрать заметку» убирало её
    /// у всех классов одной кнопкой).
    pub fn delete_class_note(&self, id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "DELETE FROM class_notes WHERE id=?1
               OR (created_by, book_id, cfi) =
                  (SELECT created_by, book_id, cfi FROM class_notes WHERE id=?1)",
            params![id],
        )?;
        Ok(n > 0)
    }

    // --- Квизы от учителя ---

    pub fn create_quiz(&self, q: &Quiz) -> rusqlite::Result<()> {
        let questions =
            serde_json::to_string(&q.questions).unwrap_or_else(|_| "[]".to_string());
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO quizzes
               (id,book_id,book_title,class_id,title,questions,created_by,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                q.id, q.book_id, q.book_title, q.class_id, q.title, questions, q.created_by,
                q.created_at
            ],
        )?;
        Ok(())
    }

    /// Все квизы (фильтрация по правам — в хендлере; нагрузка школьная, мало).
    pub fn list_quizzes(&self) -> rusqlite::Result<Vec<Quiz>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,book_id,book_title,class_id,title,questions,created_by,created_at
             FROM quizzes ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], map_quiz)?;
        rows.collect()
    }

    pub fn quiz_by_id(&self, id: &str) -> rusqlite::Result<Option<Quiz>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT id,book_id,book_title,class_id,title,questions,created_by,created_at
             FROM quizzes WHERE id=?1",
            params![id],
            map_quiz,
        );
        match r {
            Ok(q) => Ok(Some(q)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn delete_quiz(&self, id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM quiz_results WHERE quiz_id=?1", params![id])?;
        let n = conn.execute("DELETE FROM quizzes WHERE id=?1", params![id])?;
        Ok(n > 0)
    }

    /// Сохранить результат ученика (пересдача перезаписывает).
    pub fn upsert_quiz_result(
        &self,
        quiz_id: &str,
        user_id: &str,
        score: i64,
        total: i64,
        answers_json: &str,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO quiz_results (quiz_id,user_id,score,total,answers,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(quiz_id,user_id) DO UPDATE SET
                 score=excluded.score, total=excluded.total,
                 answers=excluded.answers, updated_at=excluded.updated_at",
            params![quiz_id, user_id, score, total, answers_json, now_ms()],
        )?;
        Ok(())
    }

    /// Результат конкретного ученика: (score, total).
    pub fn quiz_result_for(
        &self,
        quiz_id: &str,
        user_id: &str,
    ) -> rusqlite::Result<Option<(i64, i64)>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT score,total FROM quiz_results WHERE quiz_id=?1 AND user_id=?2",
            params![quiz_id, user_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Результаты квиза по ученикам (для учителя).
    pub fn quiz_results(&self, quiz_id: &str) -> rusqlite::Result<Vec<QuizResultRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT r.user_id, u.full_name, r.score, r.total, r.updated_at
             FROM quiz_results r JOIN users u ON u.id = r.user_id
             WHERE r.quiz_id=?1 ORDER BY u.full_name",
        )?;
        let rows = stmt.query_map(params![quiz_id], |r| {
            Ok(QuizResultRow {
                user_id: r.get(0)?,
                full_name: r.get(1)?,
                score: r.get(2)?,
                total: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?;
        rows.collect()
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

fn map_class_note(r: &rusqlite::Row) -> rusqlite::Result<ClassNote> {
    Ok(ClassNote {
        id: r.get(0)?,
        book_id: r.get(1)?,
        class_id: r.get(2)?,
        cfi: r.get(3)?,
        text: r.get(4)?,
        note: r.get(5)?,
        color: r.get(6)?,
        created_by: r.get(7)?,
        author_name: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

fn map_quiz(r: &rusqlite::Row) -> rusqlite::Result<Quiz> {
    let questions: String = r.get(5)?;
    Ok(Quiz {
        id: r.get(0)?,
        book_id: r.get(1)?,
        book_title: r.get(2)?,
        class_id: r.get(3)?,
        title: r.get(4)?,
        questions: serde_json::from_str::<Vec<QuizQuestion>>(&questions).unwrap_or_default(),
        created_by: r.get(6)?,
        created_at: r.get(7)?,
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
                // Нормализуем разделитель в '/', чтобы id совпадал с тем, что
                // формирует загрузка через API (там путь всегда через '/').
                // Иначе на Windows '\' давал другой id → дубль книги при рескане.
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
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
        db.create_user(&mk_user("u1", "user7a", Role::Student, &["7"])).unwrap();
        assert!(db.create_user(&mk_user("u2", "user7a", Role::Student, &[])).is_err()); // login UNIQUE
        let got = db.user_by_login("user7a").unwrap().unwrap();
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

    fn dp(device: &str, progress: f64, updated: i64) -> crate::models::DeviceProgress {
        crate::models::DeviceProgress {
            user_id: None,
            book_id: "b1".into(),
            device_id: device.into(),
            progress,
            locator: None,
            updated_at: updated,
        }
    }

    #[test]
    fn progress_scoped_by_account() {
        let db = mem_db();
        db.upsert_progress("u1", &dp("d1", 0.5, 2000)).unwrap();
        db.upsert_progress("u2", &dp("d2", 0.9, 3000)).unwrap();
        db.upsert_progress("", &dp("d3", 0.1, 4000)).unwrap(); // legacy без аккаунта
        // Каждый аккаунт видит только свой прогресс («продолжить везде» per-user).
        let p1 = db.latest_progress("u1", "b1").unwrap().unwrap();
        assert_eq!(p1.progress, 0.5);
        assert_eq!(p1.user_id.as_deref(), Some("u1"));
        assert_eq!(db.latest_progress("u2", "b1").unwrap().unwrap().progress, 0.9);
        assert_eq!(db.latest_progress("", "b1").unwrap().unwrap().progress, 0.1);
        // LWW внутри аккаунта: старая метка не перезаписывает.
        db.upsert_progress("u1", &dp("d1", 0.2, 1000)).unwrap();
        assert_eq!(db.latest_progress("u1", "b1").unwrap().unwrap().progress, 0.5);
    }

    fn word(normalized: &str, def: &str, updated: i64) -> crate::models::WordSyncItem {
        crate::models::WordSyncItem {
            normalized: normalized.into(),
            word: normalized.into(),
            definition: Some(def.into()),
            updated_at: updated,
            deleted: false,
        }
    }

    #[test]
    fn words_scoped_by_account() {
        let db = mem_db();
        db.upsert_words("u1", &[word("кот", "у1", 2000)]).unwrap();
        db.upsert_words("u2", &[word("кот", "у2", 3000)]).unwrap();
        // Слова разных аккаунтов не пересекаются (раньше словарь был общий).
        let w1 = db.words_since("u1", 0).unwrap();
        assert_eq!(w1.len(), 1);
        assert_eq!(w1[0].definition.as_deref(), Some("у1"));
        assert_eq!(db.words_since("u2", 0).unwrap()[0].definition.as_deref(), Some("у2"));
        assert_eq!(db.words_since("", 0).unwrap().len(), 0);
        // LWW внутри аккаунта.
        db.upsert_words("u1", &[word("кот", "старое", 1000)]).unwrap();
        assert_eq!(
            db.words_since("u1", 0).unwrap()[0].definition.as_deref(),
            Some("у1")
        );
    }

    #[test]
    fn migrates_old_progress_and_words_to_legacy_scope() {
        // Старая схема (без user_id) + данные → open() перестраивает таблицы,
        // строки попадают в legacy-скоуп '' и не теряются.
        let dir = std::env::temp_dir().join(format!("chitalka_mig_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("old.db");
        let _ = std::fs::remove_file(&path);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE progress (
                     book_id TEXT NOT NULL,
                     device_id TEXT NOT NULL,
                     progress REAL NOT NULL,
                     locator TEXT,
                     updated_at INTEGER NOT NULL,
                     PRIMARY KEY (book_id, device_id)
                 );
                 CREATE TABLE words (
                     normalized TEXT PRIMARY KEY,
                     word TEXT NOT NULL,
                     definition TEXT,
                     updated_at INTEGER NOT NULL,
                     deleted INTEGER NOT NULL DEFAULT 0
                 );
                 INSERT INTO progress VALUES ('b1','d1',0.42,'cfi/5',1234);
                 INSERT INTO words VALUES ('кот','кот','зверь',1234,0);",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let p = db.latest_progress("", "b1").unwrap().unwrap();
        assert_eq!(p.progress, 0.42);
        assert_eq!(p.device_id, "d1");
        assert!(p.user_id.is_none());
        let w = db.words_since("", 0).unwrap();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].definition.as_deref(), Some("зверь"));
        // Аккаунты стартуют с чистого скоупа.
        assert!(db.latest_progress("u1", "b1").unwrap().is_none());
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
