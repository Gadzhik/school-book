//! mDNS-поиск библиотечных серверов читалки в локальной сети (ТЗ 4.3).
//! Браузерный PWA mDNS не умеет — поэтому обнаружение делает нативная
//! оболочка (Tauri) и отдаёт найденные адреса вебу через команду.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;

/// Тип сервиса, который анонсирует сервер (см. apps/server/src/mdns.rs).
const SERVICE_TYPE: &str = "_chitalka._tcp.local.";

/// Найденный сервер — в форме, готовой для подключения веб-клиентом.
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredServer {
    /// Базовый URL, напр. "http://192.168.1.10:9700".
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub name: Option<String>,
    pub version: Option<String>,
}

/// Просканировать LAN на серверы читалки (короткий тайм-аут ~2.5 c).
/// Возвращает уникальные по адресу:порту записи. Никогда не паникует.
#[tauri::command]
pub fn discover_servers() -> Result<Vec<DiscoveredServer>, String> {
    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = mdns.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;

    let deadline = Instant::now() + Duration::from_millis(2500);
    let mut found: HashMap<String, DiscoveredServer> = HashMap::new();

    while Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(300)) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                // Предпочитаем IPv4-адрес.
                let addrs = info.get_addresses();
                let ip = addrs
                    .iter()
                    .find(|a| matches!(a, IpAddr::V4(_)))
                    .or_else(|| addrs.iter().next());
                if let Some(ip) = ip {
                    let base = format!("http://{}:{}", ip, info.get_port());
                    found.entry(base.clone()).or_insert_with(|| DiscoveredServer {
                        base_url: base,
                        name: info.get_property_val_str("name").map(|s| s.to_string()),
                        version: info.get_property_val_str("version").map(|s| s.to_string()),
                    });
                }
            }
            Ok(_) => {}
            // Тайм-аут тика — продолжаем до общего дедлайна.
            Err(_) => {}
        }
    }

    let _ = mdns.shutdown();
    Ok(found.into_values().collect())
}
