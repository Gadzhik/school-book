<#
.SYNOPSIS
  Держит суммарный вес сборочных артефактов проекта в заданном лимите.

.DESCRIPTION
  NTFS не умеет квоту на отдельную папку (квоты — только на том целиком), поэтому
  лимит держится этим скриптом: он считает вес сборочных каталогов и, если он выше
  порога, удаляет кэши по возрастанию «болезненности», пока не уложится в цель.
  Ничего невосстановимого не удаляется — только то, что заново создаётся сборкой.

  Что считается и чистится (в этом порядке):
    1. incremental-каталоги cargo   — восстановятся при следующей сборке
    2. кэш Gradle (build-cache, transforms, старые дистрибутивы) — перекачается
    3. gen/android/app/build + gen/android/.gradle — пересоберётся
    4. cargo clean для dev-профиля (debug-артефакты трёх крейтов)
    5. cargo clean для release-профиля — последний шаг, дольше всего пересобирать
    6. распакованные исходники и архивы crates.io (~/.cargo/registry) — перекачаются

  НЕ трогает: node_modules, pnpm-store, dist/ с готовыми билдами, данные сервера
  (chitalka.db, library), Android SDK/NDK, сам Flutter.

.PARAMETER MaxGb
  Порог: выше этого веса запускается чистка. По умолчанию 10 ГБ.

.PARAMETER TargetGb
  До какого веса чистить, когда порог превышен. По умолчанию 5 ГБ.

.PARAMETER Report
  Только показать раскладку по весу, ничего не удалять.

.PARAMETER Force
  Чистить до TargetGb, даже если порог не превышен.

.PARAMETER InstallTask
  Зарегистрировать ежедневную задачу планировщика (текущий пользователь, без
  прав администратора), которая запускает этот же скрипт с теми же лимитами.

.EXAMPLE
  pwsh -File scripts/limit-build-space.ps1 -Report
.EXAMPLE
  pwsh -File scripts/limit-build-space.ps1 -MaxGb 10 -TargetGb 5
.EXAMPLE
  pwsh -File scripts/limit-build-space.ps1 -InstallTask -MaxGb 10 -TargetGb 5
#>
[CmdletBinding()]
param(
    [double]$MaxGb = 10,
    [double]$TargetGb = 5,
    [switch]$Report,
    [switch]$Force,
    [switch]$InstallTask
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot 'limit-build-space.log'

function Write-Line([string]$text) {
    Write-Host $text
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $text" | Add-Content -Path $log -Encoding utf8
}

function Get-SizeGb([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return 0.0 }
    $sum = (Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if (-not $sum) { return 0.0 }
    return [math]::Round($sum / 1GB, 2)
}

# Сборочные каталоги: путь + человекочитаемое имя.
$cargoTargets = @(
    @{ Name = 'apps/server/target';            Path = Join-Path $repo 'apps\server\target' }
    @{ Name = 'apps/desktop/src-tauri/target'; Path = Join-Path $repo 'apps\desktop\src-tauri\target' }
    @{ Name = 'apps/mobile/src-tauri/target';  Path = Join-Path $repo 'apps\mobile\src-tauri\target' }
)
$gradleHome = Join-Path $env:USERPROFILE '.gradle'
$genAndroid = Join-Path $repo 'apps\mobile\src-tauri\gen\android'
$cargoHome = Join-Path $env:USERPROFILE '.cargo'

function Get-Buckets {
    $b = [ordered]@{}
    foreach ($t in $cargoTargets) { $b[$t.Name] = Get-SizeGb $t.Path }
    $b['gen/android (Gradle-сборка)'] = (Get-SizeGb (Join-Path $genAndroid 'app\build')) +
                                        (Get-SizeGb (Join-Path $genAndroid '.gradle'))
    $b['~/.gradle (кэш Gradle)'] = Get-SizeGb $gradleHome
    $b['~/.cargo/registry (crates.io)'] = Get-SizeGb (Join-Path $cargoHome 'registry')
    $b['.turbo (кэш turbo)'] = Get-SizeGb (Join-Path $repo '.turbo')
    return $b
}

function Show-Buckets($buckets, [string]$title) {
    Write-Line $title
    foreach ($k in $buckets.Keys) { Write-Line ("  {0,-32} {1,7:N2} ГБ" -f $k, $buckets[$k]) }
    $total = ($buckets.Values | Measure-Object -Sum).Sum
    Write-Line ("  {0,-32} {1,7:N2} ГБ" -f 'ИТОГО', $total)
    return [math]::Round($total, 2)
}

function Remove-Path([string]$path, [string]$why) {
    if (-not (Test-Path -LiteralPath $path)) { return 0.0 }
    $size = Get-SizeGb $path
    try {
        Remove-Item -LiteralPath $path -Recurse -Force -Confirm:$false -ErrorAction Stop
        Write-Line ("  удалено {0,7:N2} ГБ — {1} ({2})" -f $size, $why, $path)
        return $size
    } catch {
        Write-Line "  ! не удалось удалить $path — $($_.Exception.Message)"
        return 0.0
    }
}

function Invoke-CargoClean([string]$manifestDir, [switch]$ReleaseOnly, [switch]$DevOnly) {
    $cargo = Join-Path $cargoHome 'bin\cargo.exe'
    if (-not (Test-Path $cargo)) { Write-Line '  ! cargo не найден — пропуск cargo clean'; return }
    $cargoArgs = @('clean', '--manifest-path', (Join-Path $manifestDir 'Cargo.toml'))
    if ($ReleaseOnly) { $cargoArgs += '--release' }
    if ($DevOnly) { $cargoArgs += @('--profile', 'dev') }
    & $cargo @cargoArgs 2>&1 | Out-Null
}

if ($InstallTask) {
    # Хост для задачи: сначала стабильный алиас pwsh (путь не меняется при
    # обновлении PowerShell), потом текущий процесс, в крайнем случае Windows PowerShell.
    $alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\pwsh.exe'
    $ps = if (Test-Path $alias) { $alias }
          elseif ((Get-Process -Id $PID).Path) { (Get-Process -Id $PID).Path }
          else { "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" }
    $script = Join-Path $PSScriptRoot 'limit-build-space.ps1'
    $action = New-ScheduledTaskAction -Execute $ps `
        -Argument "-NoProfile -NonInteractive -File `"$script`" -MaxGb $MaxGb -TargetGb $TargetGb"
    $trigger = New-ScheduledTaskTrigger -Daily -At 03:30
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName 'school-book-limit-build-space' -Action $action `
        -Trigger $trigger -Settings $settings -Description "Держит сборочные кэши репозитория $repo в пределах $MaxGb ГБ (чистит до $TargetGb ГБ)." -Force | Out-Null
    Write-Line "задача планировщика зарегистрирована: ежедневно 03:30, лимит $MaxGb ГБ → чистка до $TargetGb ГБ"
    return
}

Write-Line "репозиторий: $repo   лимит: $MaxGb ГБ   цель чистки: $TargetGb ГБ"
$buckets = Get-Buckets
$total = Show-Buckets $buckets 'вес сборочных артефактов:'

if ($Report) { return }

if ($total -le $MaxGb -and -not $Force) {
    Write-Line "в пределах лимита ($total ГБ ≤ $MaxGb ГБ) — чистка не нужна"
    return
}

if ($total -gt $MaxGb) {
    Write-Line "лимит превышен ($total ГБ > $MaxGb ГБ) — чищу до $TargetGb ГБ"
} else {
    Write-Line "принудительная чистка (-Force): $total ГБ → цель $TargetGb ГБ"
}

# Шаг 1: incremental-каталоги cargo (самое безболезненное).
foreach ($t in $cargoTargets) {
    foreach ($prof in @('debug', 'release')) {
        Remove-Path (Join-Path $t.Path "$prof\incremental") 'incremental cargo' | Out-Null
    }
    # Инкрементальные каталоги кросс-таргетов (Android ABI и пр.).
    if (Test-Path -LiteralPath $t.Path) {
        Get-ChildItem -LiteralPath $t.Path -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                foreach ($prof in @('debug', 'release')) {
                    Remove-Path (Join-Path $_.FullName "$prof\incremental") 'incremental cargo (кросс-таргет)' | Out-Null
                }
            }
    }
}
$total = ($(Get-Buckets).Values | Measure-Object -Sum).Sum
Write-Line ("после шага 1 (incremental): {0:N2} ГБ" -f $total)

# Шаг 2: кэш Gradle. Основной вес — caches\<версия> (сгенерированные jar-ы,
# kotlin-dsl, transforms: ~1.9 ГБ на версию) и старые дистрибутивы в wrapper\dists.
# Всё это Gradle воссоздаёт сам. modules-2 (скачанные зависимости) — позже, в шаге 6,
# т.к. его восстановление требует сети.
if ($total -gt $TargetGb) {
    # Логи демона: папку целиком не трогаем — живой демон держит свой .out.log.
    Get-ChildItem (Join-Path $gradleHome 'daemon') -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
        ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    Remove-Path (Join-Path $gradleHome 'caches\build-cache-1') 'build-cache Gradle' | Out-Null
    Get-ChildItem (Join-Path $gradleHome 'caches') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(transforms|jars-|\d+\.\d+(\.\d+)?)' } |
        ForEach-Object { Remove-Path $_.FullName 'кэш Gradle (воссоздаётся)' | Out-Null }
    # Дистрибутивы Gradle: оставляем самый свежий, остальные — снести.
    $dists = Get-ChildItem (Join-Path $gradleHome 'wrapper\dists') -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    if ($dists.Count -gt 1) {
        $dists | Select-Object -Skip 1 | ForEach-Object { Remove-Path $_.FullName 'старый дистрибутив Gradle' | Out-Null }
    }
    $total = ($(Get-Buckets).Values | Measure-Object -Sum).Sum
    Write-Line ("после шага 2 (Gradle): {0:N2} ГБ" -f $total)
}

# Шаг 3: сборка Android-проекта.
if ($total -gt $TargetGb) {
    Remove-Path (Join-Path $genAndroid 'app\build') 'сборка Android-приложения' | Out-Null
    Remove-Path (Join-Path $genAndroid '.gradle') 'служебный .gradle проекта' | Out-Null
    Remove-Path (Join-Path $repo '.turbo') 'кэш turbo' | Out-Null
    $total = ($(Get-Buckets).Values | Measure-Object -Sum).Sum
    Write-Line ("после шага 3 (gen/android, turbo): {0:N2} ГБ" -f $total)
}

# Шаг 4: debug-артефакты Rust.
if ($total -gt $TargetGb) {
    foreach ($t in $cargoTargets) {
        $dir = Split-Path -Parent $t.Path
        $before = Get-SizeGb $t.Path
        Invoke-CargoClean $dir -DevOnly
        $after = Get-SizeGb $t.Path
        Write-Line ("  cargo clean --profile dev: {0} — освободило {1:N2} ГБ" -f $t.Name, ($before - $after))
    }
    $total = ($(Get-Buckets).Values | Measure-Object -Sum).Sum
    Write-Line ("после шага 4 (dev-артефакты Rust): {0:N2} ГБ" -f $total)
}

# Шаг 5: release-артефакты Rust (дольше всего пересобирать).
if ($total -gt $TargetGb) {
    foreach ($t in $cargoTargets) {
        $dir = Split-Path -Parent $t.Path
        $before = Get-SizeGb $t.Path
        Invoke-CargoClean $dir -ReleaseOnly
        $after = Get-SizeGb $t.Path
        Write-Line ("  cargo clean --release: {0} — освободило {1:N2} ГБ" -f $t.Name, ($before - $after))
    }
    $total = ($(Get-Buckets).Values | Measure-Object -Sum).Sum
    Write-Line ("после шага 5 (release-артефакты Rust): {0:N2} ГБ" -f $total)
}

# Шаг 6: то, что восстанавливается только скачиванием из сети.
if ($total -gt $TargetGb) {
    Remove-Path (Join-Path $gradleHome 'caches\modules-2') 'скачанные зависимости Gradle' | Out-Null
    Remove-Path (Join-Path $cargoHome 'registry\src') 'распакованные исходники crates.io' | Out-Null
    Remove-Path (Join-Path $cargoHome 'registry\cache') 'архивы .crate' | Out-Null
    $total = ($(Get-Buckets).Values | Measure-Object -Sum).Sum
    Write-Line ("после шага 6 (registry): {0:N2} ГБ" -f $total)
}

$buckets = Get-Buckets
$final = Show-Buckets $buckets 'итог после чистки:'
if ($final -le $TargetGb) {
    Write-Line "готово: уложились в $TargetGb ГБ"
} elseif ($final -le $MaxGb) {
    Write-Line "готово: цель $TargetGb ГБ не достигнута, но лимит $MaxGb ГБ соблюдён ($final ГБ)"
} else {
    Write-Line "ВНИМАНИЕ: после всех шагов всё ещё $final ГБ > $MaxGb ГБ — смотри раскладку выше (возможно, вырос dist/ или node_modules)"
}
