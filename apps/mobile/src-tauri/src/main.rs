// Десктоп-обёртка для запуска того же кода вне мобильной платформы
// (удобно для проверки сборки). На устройстве вход — через lib::run().
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    reader_mobile_lib::run()
}
