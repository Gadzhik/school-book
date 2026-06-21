//! Аутентификация (ТЗ Часть 6, п.6.2): хэширование паролей argon2 и JWT.
//! Пароли НИКОГДА не хранятся в открытом виде — только argon2-хэш.
//! JWT подписывается секретом сервера (персистентным, см. db meta).

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand_core::OsRng;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::models::Role;

/// Срок жизни JWT — 30 дней (вход «в любое время», офлайн-кэш на клиенте).
const TOKEN_TTL_SECS: i64 = 30 * 24 * 60 * 60;

/// Полезная нагрузка JWT.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// id пользователя.
    pub sub: String,
    /// Роль (строкой) — для быстрых проверок без обращения к БД.
    pub role: String,
    /// Срок действия (unix-секунды).
    pub exp: i64,
}

/// Захэшировать пароль (argon2id со случайной солью).
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

/// Проверить пароль против сохранённого хэша.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Сгенерировать случайный секрет JWT (hex, 32 байта) — для первого запуска.
pub fn generate_secret() -> String {
    use rand_core::RngCore;
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Выпустить JWT для пользователя.
pub fn issue_token(secret: &str, user_id: &str, role: Role) -> Result<String, String> {
    let claims = Claims {
        sub: user_id.to_string(),
        role: role.as_str().to_string(),
        exp: now_secs() + TOKEN_TTL_SECS,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| e.to_string())
}

/// Разобрать и проверить JWT. None — невалиден/просрочен.
pub fn verify_token(secret: &str, token: &str) -> Option<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|data| data.claims)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
