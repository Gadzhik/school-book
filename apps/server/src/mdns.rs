//! Автообнаружение в локальной сети (ТЗ 4.3): анонс сервиса
//! `_chitalka._tcp.local` через mDNS/DNS-SD. Нативные клиенты (Tauri)
//! находят сервер и подключаются в один тап. Браузерный PWA mDNS не умеет —
//! для него остаются QR/ручной ввод (не зависит от этого модуля).

use std::net::{IpAddr, Ipv4Addr, UdpSocket};

use mdns_sd::{ServiceDaemon, ServiceInfo};

/// Тип mDNS-сервиса (с завершающей точкой, как требует DNS-SD).
const SERVICE_TYPE: &str = "_chitalka._tcp.local.";

/// Определить локальный IPv4 исходящего интерфейса.
/// Трюк: «подключаем» UDP-сокет к внешнему адресу — пакет не шлётся, но ядро
/// выбирает исходящий интерфейс, и мы читаем его адрес.
pub fn local_ipv4() -> Ipv4Addr {
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                if let IpAddr::V4(v4) = addr.ip() {
                    return v4;
                }
            }
        }
    }
    Ipv4Addr::LOCALHOST
}

/// Имя инстанса без точек/спецсимволов (требование DNS-SD).
fn sanitize_instance(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = s.trim_matches('-');
    if trimmed.is_empty() {
        "chitalka".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Анонсировать сервер в LAN. Демон нужно держать живым (вернуть наружу) —
/// при его уничтожении сервис снимается с публикации.
pub fn announce(name: &str, port: u16, version: &str) -> mdns_sd::Result<ServiceDaemon> {
    let mdns = ServiceDaemon::new()?;
    let ip = local_ipv4();
    let ip_str = ip.to_string();
    let instance = sanitize_instance(name);
    let host = format!("chitalka-{}.local.", ip_str.replace('.', "-"));
    let props = [("version", version), ("name", name)];
    let info = ServiceInfo::new(SERVICE_TYPE, &instance, &host, ip_str.as_str(), port, &props[..])?;
    mdns.register(info)?;
    Ok(mdns)
}
