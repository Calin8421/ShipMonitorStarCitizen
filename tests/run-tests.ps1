param([string]$JdkHome = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
if (-not $JdkHome) {
    $candidate = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.jdks') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($candidate) { $JdkHome = $candidate.FullName }
}
if (-not $JdkHome) { throw 'Pass -JdkHome with a JDK path or set JAVA_HOME.' }
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    New-Item -ItemType Directory -Force -Path 'build\test-classes' | Out-Null
    & (Join-Path $JdkHome 'bin\javac.exe') -encoding UTF-8 -d build\test-classes src\ShopChecker.java tests\DumpJs.java
    if ($LASTEXITCODE -ne 0) { throw 'Compilation failed.' }
    & .\dist\ShipMonitor\runtime\bin\java.exe -cp build\test-classes DumpJs
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract scripts.' }
    node tests\checkout_logic.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Checkout tests failed.' }
    node tests\signin_logic.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Sign-in tests failed.' }
} finally { Pop-Location }
