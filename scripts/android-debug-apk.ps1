<#
.SYNOPSIS
    Сборка debug-APK читалки в обход двух ограничений Windows-машины.

.DESCRIPTION
    Прямой `tauri android build` на этой машине не доходит до конца: он собирает
    нативную библиотеку, а затем пытается положить её в `jniLibs` СИМВОЛИЧЕСКОЙ
    ССЫЛКОЙ. Без «режима разработчика» Windows симлинки требуют прав админа, и
    сборка падает. Хуже того — перед созданием ссылки Tauri УДАЛЯЕТ и файл, и
    каталог назначения, поэтому наивное «скопировать .so после падения» молча не
    срабатывает (копировать некуда), APK собирается без библиотеки и приложение
    падает на старте с `UnsatisfiedLinkError: library "libreader_mobile_lib.so"
    not found`.

    Скрипт делает всё по шагам и проверяет результат:
      1. `tauri android build` — собирает .so правильным линкером NDK
         (напрямую `cargo build --target ...` не годится: без окружения от
         Tauri CLI не находится линкер `cc`). Падение на шаге симлинка ожидаемо.
      2. Копирует .so в `jniLibs/<abi>/`, создавая каталог, и проверяет, что
         файл на месте и свежий.
      3. Чистит кэши упаковки: без этого gradle оставляет в архиве старую .so
         мёртвым весом (APK раздувается вдвое) либо не подхватывает новую.
      4. `gradlew assemble<Abi>Debug` с исключением задачи rustBuild — Rust уже
         собран на шаге 1, а сама задача на этой машине падает (зовёт pnpm).
      5. Проверяет, что .so реально попала внутрь APK.

.PARAMETER Abi
    Архитектура: arm64 (телефоны) или x86_64 (эмулятор).

.PARAMETER Install
    Поставить собранный APK на подключённое устройство/эмулятор.

.EXAMPLE
    pwsh -File scripts/android-debug-apk.ps1 -Abi x86_64 -Install
#>
[CmdletBinding()]
param(
    [ValidateSet('arm64', 'x86_64')]
    [string]$Abi = 'arm64',
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $repo 'apps\mobile'
$android = Join-Path $mobile 'src-tauri\gen\android'

# Соответствие: имя таргета для Tauri CLI (ВНИМАНИЕ: у него «aarch64», а не
# «arm64» — на неверном значении сборка .so молча не выполняется и APK
# уезжает со старой библиотекой), таргет Rust, папка jniLibs, задача gradle.
$map = @{
    'arm64'  = @{ Tauri = 'aarch64'; Target = 'aarch64-linux-android'; JniDir = 'arm64-v8a'; Task = 'Arm64' }
    'x86_64' = @{ Tauri = 'x86_64'; Target = 'x86_64-linux-android'; JniDir = 'x86_64'; Task = 'X86_64' }
}
$cfg = $map[$Abi]

if (-not (Test-Path $android)) {
    throw "Нет сгенерированного Android-проекта ($android). Сначала: pnpm --filter @reader/mobile android:init"
}

Write-Host "== 1. нативная библиотека ($($cfg.Target))" -ForegroundColor Cyan
Push-Location $mobile
try {
    # Падение на шаге симлинка ожидаемо — важно, что .so соберётся.
    & pnpm tauri android build --debug --apk --target $cfg.Tauri 2>&1 |
        Select-String -Pattern 'Compiling reader-mobile|Finished|error\[|error:' |
        ForEach-Object { "   $_" }
} finally {
    Pop-Location
}

$so = Join-Path $mobile "src-tauri\target\$($cfg.Target)\debug\libreader_mobile_lib.so"
if (-not (Test-Path $so)) { throw "Нативная библиотека не собралась: $so" }

# Web-сборка зашивается внутрь .so на этапе компиляции. Если библиотека старше
# бандла — шаг 1 не отработал (например, неверный таргет), и APK уехал бы со
# старым интерфейсом. Такую тихую промашку ловим здесь.
$webIndex = Join-Path $repo 'apps\web\dist\index.html'
if (Test-Path $webIndex) {
    $soTime = (Get-Item $so).LastWriteTime
    $webTime = (Get-Item $webIndex).LastWriteTime
    if ($soTime -lt $webTime) {
        throw ("Нативная библиотека ($soTime) СТАРШЕ web-сборки ($webTime) — " +
            'внутрь APK попал бы прошлый интерфейс. Проверьте вывод шага 1.')
    }
}

Write-Host "== 2. кладём .so в jniLibs" -ForegroundColor Cyan
$jniDir = Join-Path $android "app\src\main\jniLibs\$($cfg.JniDir)"
# Каталог создаём ЗАНОВО: Tauri удаляет его перед неудачным симлинком.
New-Item -ItemType Directory -Force -Path $jniDir | Out-Null
$dst = Join-Path $jniDir 'libreader_mobile_lib.so'
Copy-Item $so $dst -Force
$copied = Get-Item $dst -ErrorAction SilentlyContinue
if (-not $copied -or $copied.Length -lt 1MB) { throw "Копия .so не на месте: $dst" }
Write-Host ("   {0} МБ, собрана {1}" -f [math]::Round($copied.Length / 1MB, 1), $copied.LastWriteTime)

Write-Host "== 3. чистим кэши упаковки" -ForegroundColor Cyan
# Только результат упаковки: иначе gradle дописывает новую .so в старый архив
# и APK раздувается вдвое (99 → 191 МБ) за счёт мёртвого веса. Промежуточные
# merged/stripped_native_libs не трогаем — они пересобираются сами по хэшу.
foreach ($d in 'outputs\apk', 'intermediates\apk') {
    Remove-Item (Join-Path $android "app\$d") -Recurse -Force -ErrorAction SilentlyContinue
}

$apk = Join-Path $android "app\build\outputs\apk\$Abi\debug\app-$Abi-debug.apk"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Invoke-Assemble {
    Push-Location $android
    try {
        & .\gradlew.bat "assemble$($cfg.Task)Debug" "-x" ":app:rustBuild$($cfg.Task)Debug" --console=plain 2>&1 |
            Select-Object -Last 3 | ForEach-Object { "   $_" }
    } finally {
        Pop-Location
    }
}

# Возвращает: есть ли внутри .so и во сколько раз файл больше суммы записей.
function Test-Apk {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
    try {
        $inside = $zip.Entries | Where-Object { $_.FullName -like '*libreader_mobile_lib.so' }
        $sum = ($zip.Entries | Measure-Object -Property CompressedLength -Sum).Sum
        [pscustomobject]@{
            HasSo = [bool]$inside
            SoName = if ($inside) { $inside.FullName } else { '' }
            SoMb = if ($inside) { [math]::Round($inside.Length / 1MB, 1) } else { 0 }
            Bloat = (Get-Item $apk).Length / [math]::Max($sum, 1)
        }
    } finally {
        $zip.Dispose()
    }
}

Write-Host "== 4. сборка APK" -ForegroundColor Cyan
Invoke-Assemble
if (-not (Test-Path $apk)) { throw "APK не собрался: $apk" }

Write-Host "== 5. проверка содержимого APK" -ForegroundColor Cyan
$info = Test-Apk
# Смена .so оставляет прошлую копию мёртвым весом внутри архива (99 → 191 МБ):
# запись в центральном каталоге одна, но байты старой лежат рядом. Лечится
# переупаковкой с нуля — она быстрая, Kotlin/ресурсы уже собраны.
if ($info.Bloat -gt 1.3) {
    # Точечной чистки мало: gradle отдаёт тот же раздутый архив из своего кэша
    # сборки. Помогает только снос всего app/build (~40 с, Kotlin пересоберётся).
    Write-Host "   в архиве остались байты прошлой .so — полная переупаковка" -ForegroundColor Yellow
    Remove-Item (Join-Path $android 'app\build') -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-Assemble
    $info = Test-Apk
}
if (-not $info.HasSo) { throw "В APK НЕТ нативной библиотеки — приложение упадёт на старте" }
Write-Host ("   {0} — {1} МБ" -f $info.SoName, $info.SoMb)
if ($info.Bloat -gt 1.3) { Write-Warning "APK всё ещё раздут — проверьте кэши gradle вручную" }
Write-Host ("   APK: {0} ({1} МБ)" -f $apk, [math]::Round((Get-Item $apk).Length / 1MB, 1)) -ForegroundColor Green

if ($Install) {
    Write-Host "== 6. установка на устройство" -ForegroundColor Cyan
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (-not (Test-Path $adb)) { $adb = 'adb' }
    & $adb install -r $apk | Select-Object -Last 1 | ForEach-Object { "   $_" }
}
