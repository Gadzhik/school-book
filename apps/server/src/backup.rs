//! Резервное копирование: настраиваемый автобэкап по расписанию + ручные
//! операции (сделать сейчас, список копий, полный архив с книгами).
//!
//! Настройки хранятся в meta-таблице БД (ключ `backup_settings`, JSON) и
//! правятся админом через API на лету — фоновая задача перечитывает их по
//! сигналу [`tokio::sync::Notify`]. Начальные значения (до первого сохранения
//! через API) можно задать переменными окружения:
//!   CHITALKA_BACKUP_ENABLED   — 1/true: включить автобэкап
//!   CHITALKA_BACKUP_MODE      — interval | daily
//!   CHITALKA_BACKUP_EVERY_HOURS — период в часах (mode=interval, по умолч. 24)
//!   CHITALKA_BACKUP_DAILY_AT  — время «HH:MM» местное (mode=daily, по умолч. 03:30)
//!   CHITALKA_BACKUP_KEEP      — сколько последних копий хранить (по умолч. 7)
//!   CHITALKA_BACKUP_DIR       — папка копий (по умолч. <папка БД>/backups)
//!   CHITALKA_BACKUP_BOOKS     — 1/true: полный архив (БД + библиотека), иначе только БД

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use chrono::{Local, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};

use crate::db::Db;

/// Ключ настроек в meta-таблице.
const META_KEY: &str = "backup_settings";
/// Ключ отметки последнего успешного автобэкапа (мс epoch) — чтобы рестарт
/// сервера не сбрасывал интервал.
const META_LAST: &str = "backup_last_ms";
/// Префикс имён файлов копий (по нему же работает ротация).
const PREFIX: &str = "chitalka-backup-";

/// Настройки автобэкапа. Все поля правятся через PUT /api/backup/settings.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupSettings {
    /// Включён ли автоматический бэкап.
    pub enabled: bool,
    /// Режим расписания: "interval" (каждые N часов) или "daily" (в HH:MM).
    pub mode: String,
    /// Период в часах для mode=interval (>=1).
    pub every_hours: u32,
    /// Время суток «HH:MM» (местное) для mode=daily.
    pub daily_at: String,
    /// Сколько последних копий хранить (старые удаляются, >=1).
    pub keep: u32,
    /// Папка для копий; пустая строка → <папка БД>/backups.
    pub dir: String,
    /// true — полный zip-архив (БД + папка библиотеки), false — только БД.
    pub include_books: bool,
}

impl Default for BackupSettings {
    fn default() -> Self {
        BackupSettings {
            enabled: false,
            mode: "daily".into(),
            every_hours: 24,
            daily_at: "03:30".into(),
            keep: 7,
            dir: String::new(),
            include_books: false,
        }
    }
}

impl BackupSettings {
    /// Проверить корректность полей; возвращает описание ошибки по-русски.
    pub fn validate(&self) -> Result<(), String> {
        if self.mode != "interval" && self.mode != "daily" {
            return Err("режим должен быть interval или daily".into());
        }
        if self.mode == "interval" && self.every_hours == 0 {
            return Err("период должен быть не меньше 1 часа".into());
        }
        if self.mode == "daily" && parse_hhmm(&self.daily_at).is_none() {
            return Err("время должно быть в формате HH:MM".into());
        }
        if self.keep == 0 {
            return Err("нужно хранить хотя бы 1 копию".into());
        }
        if self.keep > 365 {
            return Err("хранить больше 365 копий не имеет смысла".into());
        }
        Ok(())
    }
}

/// «HH:MM» → NaiveTime (для расписания daily).
fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

fn env_flag(name: &str) -> Option<bool> {
    std::env::var(name).ok().map(|v| {
        let v = v.trim().to_lowercase();
        v == "1" || v == "true" || v == "yes" || v == "on"
    })
}

/// Настройки из переменных окружения — начальные значения до первого
/// сохранения через API (когда в meta ещё нет `backup_settings`).
fn settings_from_env() -> BackupSettings {
    let mut s = BackupSettings::default();
    if let Some(b) = env_flag("CHITALKA_BACKUP_ENABLED") {
        s.enabled = b;
    }
    if let Ok(m) = std::env::var("CHITALKA_BACKUP_MODE") {
        let m = m.trim().to_lowercase();
        if m == "interval" || m == "daily" {
            s.mode = m;
        }
    }
    if let Some(h) = std::env::var("CHITALKA_BACKUP_EVERY_HOURS")
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|h| *h >= 1)
    {
        s.every_hours = h;
    }
    if let Ok(t) = std::env::var("CHITALKA_BACKUP_DAILY_AT") {
        if parse_hhmm(&t).is_some() {
            s.daily_at = t.trim().to_string();
        }
    }
    if let Some(k) = std::env::var("CHITALKA_BACKUP_KEEP")
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|k| *k >= 1)
    {
        s.keep = k;
    }
    if let Ok(d) = std::env::var("CHITALKA_BACKUP_DIR") {
        if !d.trim().is_empty() {
            s.dir = d.trim().to_string();
        }
    }
    if let Some(b) = env_flag("CHITALKA_BACKUP_BOOKS") {
        s.include_books = b;
    }
    s
}

/// Загрузить настройки: meta-таблица (сохранённые через API) → иначе env.
pub fn load_settings(db: &Db) -> BackupSettings {
    db.meta_get(META_KEY)
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_else(settings_from_env)
}

/// Сохранить настройки в meta-таблицу (перекрывают env навсегда).
pub fn save_settings(db: &Db, s: &BackupSettings) -> Result<(), String> {
    s.validate()?;
    let json = serde_json::to_string(s).map_err(|e| e.to_string())?;
    db.meta_set(META_KEY, &json).map_err(|e| e.to_string())
}

/// Папка копий с учётом настроек: явная из настроек или <папка БД>/backups.
pub fn resolve_dir(s: &BackupSettings, db_path: &Path) -> PathBuf {
    if !s.dir.trim().is_empty() {
        return PathBuf::from(s.dir.trim());
    }
    db_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("backups")
}

/// Описание файла копии (для списка в админке).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub name: String,
    pub size: u64,
    /// Время изменения файла, мс epoch.
    pub modified_ms: i64,
}

/// Список копий в папке (свежие сверху). Отсутствующая папка → пустой список.
pub fn list_backups(dir: &Path) -> Vec<BackupFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<BackupFile> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with(PREFIX) {
                return None;
            }
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Some(BackupFile { name, size: meta.len(), modified_ms })
        })
        .collect();
    out.sort_by(|a, b| b.name.cmp(&a.name)); // имя содержит timestamp
    out
}

/// Удалить старые копии сверх лимита keep (по имени: свежие — лексикографически
/// последние, т.к. имя содержит YYYYMMDD-HHMMSS).
fn rotate(dir: &Path, keep: u32) {
    let files = list_backups(dir); // уже свежие сверху
    for f in files.iter().skip(keep as usize) {
        let _ = fs::remove_file(dir.join(&f.name));
    }
}

/// Рекурсивно добавить содержимое папки в zip под префиксом `zip_prefix/`.
/// Книги (epub/cbz и пр.) уже сжаты — кладём без компрессии (быстро).
fn zip_dir(
    zip: &mut zip::ZipWriter<fs::File>,
    root: &Path,
    dir: &Path,
    zip_prefix: &str,
) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            zip_dir(zip, root, &path, zip_prefix)?;
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "strip_prefix"))?;
        // Имена в zip — с прямыми слэшами (spec), независимо от ОС.
        let name = format!(
            "{zip_prefix}/{}",
            rel.to_string_lossy().replace('\\', "/")
        );
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .large_file(true);
        zip.start_file(name, opts)?;
        let mut f = fs::File::open(&path)?;
        io::copy(&mut f, zip)?;
    }
    Ok(())
}

/// Собрать полный архив в dest: chitalka.db (согласованная копия) + library/.
/// Блокирующая операция — вызывать через spawn_blocking.
pub fn write_full_zip(db: &Db, library: &Path, dest: &Path) -> io::Result<()> {
    let tmp_db = std::env::temp_dir().join(format!("chitalka_vacuum_{}.db", crate::now_ms()));
    db.backup_to(&tmp_db)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("VACUUM INTO: {e}")))?;
    let result = (|| -> io::Result<()> {
        let file = fs::File::create(dest)?;
        let mut zip = zip::ZipWriter::new(file);
        // БД сжимаем: SQLite-файл ужимается в разы.
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);
        zip.start_file("chitalka.db", opts)?;
        let mut f = fs::File::open(&tmp_db)?;
        io::copy(&mut f, &mut zip)?;
        if library.is_dir() {
            zip_dir(&mut zip, library, library, "library")?;
        }
        zip.finish()?.flush()?;
        Ok(())
    })();
    let _ = fs::remove_file(&tmp_db);
    if result.is_err() {
        let _ = fs::remove_file(dest); // не оставлять битый архив
    }
    result
}

/// Сделать копию по настройкам: .db (только БД) или .zip (БД + книги),
/// затем ротация. Возвращает (имя файла, размер). Блокирующая операция.
pub fn perform_backup(
    db: &Db,
    db_path: &Path,
    library: &Path,
    s: &BackupSettings,
) -> io::Result<(String, u64)> {
    let dir = resolve_dir(s, db_path);
    fs::create_dir_all(&dir)?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S");
    let name = if s.include_books {
        format!("{PREFIX}{stamp}.zip")
    } else {
        format!("{PREFIX}{stamp}.db")
    };
    let dest = dir.join(&name);
    if s.include_books {
        write_full_zip(db, library, &dest)?;
    } else {
        db.backup_to(&dest)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("VACUUM INTO: {e}")))?;
    }
    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    rotate(&dir, s.keep);
    let _ = db.meta_set(META_LAST, &crate::now_ms().to_string());
    Ok((name, size))
}

/// Не устарела ли необходимость интервальной копии к моменту пробуждения:
/// пока задача спала, ручная копия могла обновить отметку последнего запуска —
/// тогда очередную не делаем (иначе дубль). Для daily всегда true: пробуждение
/// значит «время суток настало».
pub fn still_due(db: &Db, s: &BackupSettings) -> bool {
    if s.mode == "daily" {
        return true;
    }
    let last: i64 = db
        .meta_get(META_LAST)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let due = last + (s.every_hours as i64) * 3_600_000;
    due - crate::now_ms() <= 60_000
}

/// Сколько ждать до следующего автобэкапа по настройкам.
/// None — автобэкап выключен (ждать только сигнала изменения настроек).
pub fn next_delay(db: &Db, s: &BackupSettings) -> Option<std::time::Duration> {
    if !s.enabled {
        return None;
    }
    if s.mode == "daily" {
        let at = parse_hhmm(&s.daily_at)?;
        let now = Local::now();
        let today = now.date_naive().and_time(at);
        let mut next = Local.from_local_datetime(&today).earliest()?;
        if next <= now {
            next = Local
                .from_local_datetime(&(today + chrono::Duration::days(1)))
                .earliest()?;
        }
        return Some((next - now).to_std().unwrap_or_default());
    }
    // interval: от последнего успешного запуска (переживает рестарт).
    let last: i64 = db
        .meta_get(META_LAST)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let period_ms = (s.every_hours as i64) * 3_600_000;
    let due = last + period_ms;
    let now = crate::now_ms();
    if due <= now {
        // Просрочено (или ни разу не делалось) — через полминуты после старта,
        // чтобы не мешать инициализации.
        return Some(std::time::Duration::from_secs(30));
    }
    Some(std::time::Duration::from_millis((due - now) as u64))
}
