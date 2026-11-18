param(
    [string]$JdkHome = $env:JAVA_HOME,
    [switch]$Installer
)

$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot

# Prefer an explicitly selected JDK, then look for a full JDK on PATH or in
# common per-user JDK directories. A JRE alone cannot build the application.
if (-not $JdkHome) {
    $javac = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($javac) { $JdkHome = Split-Path (Split-Path $javac.Source -Parent) -Parent }
}
if (-not $JdkHome) {
    $jdkRoot = Join-Path $env:USERPROFILE '.jdks'
    if (Test-Path -LiteralPath $jdkRoot) {
        $candidate = Get-ChildItem -LiteralPath $jdkRoot -Directory | Sort-Object Name -Descending |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\jpackage.exe') } |
            Select-Object -First 1
        if ($candidate) { $JdkHome = $candidate.FullName }
    }
}
if (-not $JdkHome) { throw 'A JDK with javac, jar, jlink and jpackage is required. Set JAVA_HOME or pass -JdkHome.' }
$JdkHome = (Resolve-Path -LiteralPath $JdkHome).Path
$tools = @{}
foreach ($name in @('javac', 'jar', 'jlink', 'jpackage')) {
    $path = Join-Path $JdkHome "bin\$name.exe"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing $path. Select a full JDK, version 17 or newer." }
    $tools[$name] = $path
}

function Invoke-JdkTool([string]$Name, [string[]]$ToolArguments) {
    & $tools[$Name] @ToolArguments
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

$buildDir = Join-Path $projectDir 'build'
$classesDir = Join-Path $buildDir 'classes'
$inputDir = Join-Path $buildDir 'input'
$runtimeDir = Join-Path $buildDir 'runtime'
$distDir = Join-Path $projectDir 'dist'
$appDir = Join-Path $distDir 'ShipMonitor'

function Remove-GeneratedDirectory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $root = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $projectDir).ProviderPath).TrimEnd('\')
    $resolved = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).ProviderPath)
    if (-not $resolved.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the project: $resolved"
    }
    # Refuse reparse points along the path and within the generated directory.
    # This prevents cleanup from traversing a junction or symbolic link.
    $current = Get-Item -LiteralPath $resolved -Force
    while ($current -and $current.FullName.Length -ge $root.Length) {
        if (($current.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to remove a path containing a junction or symbolic link: $($current.FullName)"
        }
        if ($current.FullName.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) { break }
        $current = $current.Parent
    }
    $links = @(Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object {
        ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    })
    if ($links.Count -gt 0) { throw "Refusing to remove a generated directory containing a junction or symbolic link: $($links[0].FullName)" }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

# Do not partially delete an application image that is in use. Close the
# application before rebuilding this output folder.
$appLauncher = Join-Path $appDir 'ShipMonitor.exe'
$runningApps = @(Get-Process -Name 'ShipMonitor' -ErrorAction SilentlyContinue | Where-Object {
    try { -not $_.Path -or $_.Path.Equals($appLauncher, [System.StringComparison]::OrdinalIgnoreCase) }
    catch { $true }
})
if ($runningApps.Count -gt 0) {
    throw "The application in $appDir is running. Close it before rebuilding this folder."
}

# These paths are fixed children of the project, not user-supplied paths.
foreach ($path in @($classesDir, $inputDir, $runtimeDir, $appDir)) {
    Remove-GeneratedDirectory $path
}
New-Item -ItemType Directory -Force -Path $classesDir, $inputDir, $distDir | Out-Null
$sources = @(Get-ChildItem -LiteralPath (Join-Path $projectDir 'src') -Recurse -Filter '*.java' -File | ForEach-Object FullName)
if ($sources.Count -eq 0) { throw 'No Java source files were found in src.' }

Invoke-JdkTool 'javac' (@('-encoding', 'UTF-8', '-d', $classesDir) + $sources)
$jarPath = Join-Path $inputDir 'ShipMonitor.jar'
Invoke-JdkTool 'jar' @('--create', '--file', $jarPath, '--main-class', 'ShipMonitorApp', '-C', $classesDir, '.')
Copy-Item -LiteralPath $jarPath -Destination (Join-Path $distDir 'ShipMonitor.jar') -Force

# jlink makes a private runtime containing the standard modules used by the app.
Invoke-JdkTool 'jlink' @('--add-modules', 'java.desktop,java.net.http,jdk.crypto.ec', '--strip-debug', '--no-header-files', '--no-man-pages', '--output', $runtimeDir)
Invoke-JdkTool 'jpackage' @('--type', 'app-image', '--name', 'ShipMonitor', '--input', $inputDir, '--main-jar', 'ShipMonitor.jar', '--main-class', 'ShipMonitorApp', '--runtime-image', $runtimeDir, '--dest', $distDir, '--app-version', '1.0.0')

Write-Host "Built: $(Join-Path $distDir 'ShipMonitor.jar')"
Write-Host "Built: $(Join-Path $appDir 'ShipMonitor.exe') (distribute the entire ShipMonitor folder)"

if ($Installer) {
    # jpackage requires a supported WiX installation on PATH for Windows installers.
    Invoke-JdkTool 'jpackage' @('--type', 'exe', '--name', 'ShipMonitor', '--app-image', $appDir, '--dest', $distDir, '--app-version', '1.0.0', '--win-dir-chooser', '--win-menu', '--win-shortcut', '--win-per-user-install')
    Write-Host "Installer created in $distDir."
}
