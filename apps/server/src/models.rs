//! Модели данных сервера (зеркалят типы @reader/network: DeviceProgress,
//! WordSyncItem). Сериализация — serde JSON для REST-API (ТЗ 4.4).

use serde::{Deserialize, Serialize};

/// Книга в каталоге.
#[derive(Debug, Clone, Serialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub size: i64,
    pub added_at: i64,
}

/// Прогресс чтения на устройстве (LWW по updated_at — ТЗ 4.4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceProgress {
    #[serde(rename = "bookId")]
    pub book_id: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub progress: f64,
    #[serde(default)]
    pub locator: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

/// Элемент синхронизации словаря «Мои слова» (LWW, с тумбстоунами).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSyncItem {
    pub normalized: String,
    pub word: String,
    #[serde(default)]
    pub definition: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(default)]
    pub deleted: bool,
}

/// Ответ /status (для пинга и отображения имени/адреса сервера).
#[derive(Debug, Serialize)]
pub struct ServerStatus {
    pub name: String,
    pub version: String,
    pub books: i64,
    pub ok: bool,
    /// LAN-IP, на котором сервер доступен другим устройствам.
    pub address: String,
    /// Порт, который сервер реально занял.
    pub port: u16,
}

// --- Аккаунты и роли (ТЗ Часть 6) ---

/// Роль пользователя (RBAC, ТЗ 6.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Полный доступ, настройки сервера.
    Admin,
    /// Завуч/библиотекарь: контент и люди всей школы, без системных настроек.
    Power,
    /// Учитель: свои предметы/классы.
    Teacher,
    /// Ученик: чтение/скачивание.
    Student,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Power => "power",
            Role::Teacher => "teacher",
            Role::Student => "student",
        }
    }
    pub fn from_str(s: &str) -> Option<Role> {
        match s {
            "admin" => Some(Role::Admin),
            "power" => Some(Role::Power),
            "teacher" => Some(Role::Teacher),
            "student" => Some(Role::Student),
            _ => None,
        }
    }
}

/// Статус учётной записи (ученик/учитель ждёт одобрения — ТЗ 6.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
    /// Ждёт одобрения (прав нет).
    Pending,
    /// Активна.
    Active,
    /// Заблокирована.
    Blocked,
}

impl UserStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            UserStatus::Pending => "pending",
            UserStatus::Active => "active",
            UserStatus::Blocked => "blocked",
        }
    }
    pub fn from_str(s: &str) -> UserStatus {
        match s {
            "active" => UserStatus::Active,
            "blocked" => UserStatus::Blocked,
            _ => UserStatus::Pending,
        }
    }
}

/// Учётная запись (внутреннее представление; pw_hash не сериализуется наружу).
#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub role: Role,
    pub status: UserStatus,
    pub full_name: String,
    pub login: String,
    pub pw_hash: String,
    pub subjects: Vec<String>,
    pub classes: Vec<String>,
    pub created_at: i64,
}

impl User {
    /// Публичное представление (без хэша пароля) — для ответов клиенту.
    pub fn public(&self) -> PublicUser {
        PublicUser {
            id: self.id.clone(),
            role: self.role,
            status: self.status,
            full_name: self.full_name.clone(),
            login: self.login.clone(),
            subjects: self.subjects.clone(),
            classes: self.classes.clone(),
            created_at: self.created_at,
        }
    }
}

/// Учётка для отдачи клиенту (без секретов).
#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: String,
    pub role: Role,
    pub status: UserStatus,
    #[serde(rename = "fullName")]
    pub full_name: String,
    pub login: String,
    pub subjects: Vec<String>,
    pub classes: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

/// Запрос регистрации (ТЗ 6.2). Учитель: subjects+classes; ученик: class.
#[derive(Debug, Deserialize)]
pub struct RegisterReq {
    /// Желаемая роль: teacher | student (admin/power — только первым, бутстрап).
    pub role: String,
    #[serde(rename = "fullName")]
    pub full_name: String,
    pub login: String,
    pub password: String,
    #[serde(default)]
    pub subjects: Vec<String>,
    #[serde(default)]
    pub classes: Vec<String>,
    /// Класс ученика (одиночный) — кладётся в classes.
    #[serde(default)]
    pub class: Option<String>,
}

/// Запрос входа.
#[derive(Debug, Deserialize)]
pub struct LoginReq {
    pub login: String,
    pub password: String,
}

/// Ответ авторизации: JWT + профиль.
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: PublicUser,
}

// --- Задания и прогресс класса (ТЗ Часть 6, п.6.5 / E1+E2) ---

/// Задание: книга, назначенная классу учителем (с опц. дедлайном).
#[derive(Debug, Clone, Serialize)]
pub struct Assignment {
    pub id: String,
    /// id книги на сервере.
    #[serde(rename = "bookId")]
    pub book_id: String,
    /// Денормализованное название книги (для отображения).
    #[serde(rename = "bookTitle")]
    pub book_title: String,
    #[serde(rename = "classId")]
    pub class_id: String,
    pub title: String,
    pub note: Option<String>,
    #[serde(rename = "dueAt")]
    pub due_at: Option<i64>,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

/// Запрос создания задания.
#[derive(Debug, Deserialize)]
pub struct AssignmentReq {
    #[serde(rename = "bookId")]
    pub book_id: String,
    #[serde(rename = "classId")]
    pub class_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(rename = "dueAt", default)]
    pub due_at: Option<i64>,
}

/// Отметка ученика о выполнении задания.
#[derive(Debug, Deserialize)]
pub struct AssignmentProgressReq {
    /// "reading" | "done".
    pub status: String,
    #[serde(default)]
    pub fraction: f64,
}

/// Строка отчёта по классу: ученик + его статус выполнения задания.
#[derive(Debug, Serialize)]
pub struct AssignmentReportRow {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "fullName")]
    pub full_name: String,
    /// "not_started" | "reading" | "done".
    pub status: String,
    pub fraction: f64,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<i64>,
}

/// Задание с личным статусом ученика (для списка ученика).
#[derive(Debug, Serialize)]
pub struct AssignmentForStudent {
    #[serde(flatten)]
    pub assignment: Assignment,
    /// Личный статус: "not_started" | "reading" | "done".
    pub status: String,
    pub fraction: f64,
}

/// Элемент синхронизации закладок (ТЗ Часть 6, п.6.3; LWW по updatedAt, per-user).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkSyncItem {
    pub id: String,
    #[serde(rename = "bookId")]
    pub book_id: String,
    pub locator: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub excerpt: Option<String>,
    #[serde(default)]
    pub fraction: Option<f64>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(default)]
    pub deleted: bool,
}

/// Элемент синхронизации выделений (ТЗ Часть 6, E3; LWW по updatedAt, per-user).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightSyncItem {
    pub id: String,
    #[serde(rename = "bookId")]
    pub book_id: String,
    pub cfi: String,
    pub text: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub fraction: Option<f64>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(default)]
    pub deleted: bool,
}

/// Запись журнала действий (аудит, ТЗ Часть 6, E8).
#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub ts: i64,
    /// Кто (ФИО/логин).
    pub actor: String,
    /// Что (register/approve/reject/upload/assign/unassign…).
    pub action: String,
    pub detail: Option<String>,
}
