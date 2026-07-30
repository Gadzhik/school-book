# Еженедельная чистка билд-кэшей (Windows Task Scheduler).
# - cargo sweep: удаляет из target/ артефакты старше 30 дней (свежие остаются,
#   инкрементальные сборки не страдают).
# - gen/android/app/build (Gradle): удаляется целиком, если не менялся 30+ дней.
# Логи: scripts/clean-build-cache.log (перезаписывается при каждом запуске).

# Корень репо — от расположения самого скрипта (путь был захардкожен под первую
# Windows-машину `C:\ai_dev\school_book` и ломался на других клонах).
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $repo 'scripts\clean-build-cache.log'
$days = 30

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm')] старт чистки" | Set-Content $log

$sweep = Join-Path $env:USERPROFILE '.cargo\bin\cargo-sweep.exe'
if (Test-Path $sweep) {
    & $sweep sweep --time $days -r $repo 2>&1 | Add-Content $log
} else {
    "cargo-sweep не найден ($sweep) — пропуск Rust-кэшей" | Add-Content $log
}

$gradleBuild = Join-Path $repo 'apps\mobile\src-tauri\gen\android\app\build'
if (Test-Path $gradleBuild) {
    $lastWrite = (Get-ChildItem $gradleBuild -Recurse -Force -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    if ($lastWrite -and $lastWrite -lt (Get-Date).AddDays(-$days)) {
        Remove-Item $gradleBuild -Recurse -Force -Confirm:$false
        "удалён Gradle-кэш: $gradleBuild (не менялся с $lastWrite)" | Add-Content $log
    } else {
        "Gradle-кэш свежий (посл. запись $lastWrite) — оставлен" | Add-Content $log
    }
}

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm')] готово" | Add-Content $log
