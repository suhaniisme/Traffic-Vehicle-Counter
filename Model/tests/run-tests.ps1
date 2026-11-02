# One-command test runner: starts serve.ps1, opens tests/test.html in headless
# Chrome (or Edge), waits for the results JSON and prints a summary.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1                 # unit + end-to-end
#   powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Suite unit     # unit only
#   powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1 -Tiles 0 -Tag notiles

param(
    [ValidateSet('unit', 'all')] [string]$Suite = 'all',
    [string]$Model = '',
    [string]$Tiles = '',
    [string]$Score = '',
    [string]$Only = '',
    [string]$Tag = 'default',
    [int]$Port = 8765,
    [int]$TimeoutSec = 900
)

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $PSScriptRoot 'output'
New-Item -ItemType Directory -Force $outDir | Out-Null
$resultFile = Join-Path $outDir "$($Tag)__results.json"
Remove-Item $resultFile -ErrorAction SilentlyContinue

$browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Chrome or Edge not found.' }

$server = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'serve.ps1'), '-Port', $Port, '-Root', $root)

$query = "suite=$Suite&save=1&tag=$Tag"
if ($Model) { $query += "&model=$Model" }
if ($Tiles) { $query += "&tiles=$Tiles" }
if ($Score) { $query += "&score=$Score" }
if ($Only) { $query += "&only=$Only" }
$url = "http://localhost:$Port/tests/test.html?$query"

# One browser profile per port, so parallel runs do not share (or kill) a browser.
$profileName = "traffic-counter-test-profile-$Port"
$profileDir = Join-Path $env:TEMP $profileName
$chrome = $null
try {
    Start-Sleep -Seconds 2
    $chrome = Start-Process $browser -PassThru -ArgumentList @(
        '--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--no-first-run', '--no-default-browser-check', "--user-data-dir=$profileDir", $url)

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while (-not (Test-Path $resultFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    if (-not (Test-Path $resultFile)) { throw "Timed out after $TimeoutSec s waiting for $resultFile" }
    Start-Sleep -Milliseconds 500

    $report = Get-Content $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $failed = @($report.unit | Where-Object { -not $_.pass })
    Write-Host ("Unit tests: {0}/{1} passed" -f ($report.unit.Count - $failed.Count), $report.unit.Count)
    $failed | ForEach-Object { Write-Host ("  FAIL {0} -- {1}" -f $_.name, $_.error) }
    if ($report.error) { Write-Host "ERROR: $($report.error)" }

    if ($report.e2e) {
        Write-Host ''
        Write-Host 'End-to-end (expected/detected):'
        $report.e2e.rows | ForEach-Object {
            Write-Host ("  {0,-28} total {1,3}/{2,-3} cars {3,3}/{4,-3} LMV {5,3}/{6,-3} HMV {7,2}/{8,-2} Moto {9,3}/{10,-3} {11,6} ms" -f `
                $_.file, $_.expected.total, $_.got.total, $_.expected.cars, $_.got.cars, $_.expected.LMV, $_.got.LMV,
                $_.expected.HMV, $_.got.HMV, $_.expected.Motorcycle, $_.got.Motorcycle, $_.ms)
        }
        $a = $report.e2e.aggregate
        Write-Host ''
        Write-Host ("Aggregate ({0}): count accuracy {1:P1}, avg {2} ms/image, model load {3} ms, backend {4}" -f $a.model, $a.countAccuracy, $a.avgMs, $a.modelLoadMs, $a.backend)
        foreach ($k in 'total', 'cars', 'LMV', 'HMV', 'Motorcycle') {
            Write-Host ("  {0,-10} MAE {1,5}  expected {2,4}  detected {3,4}" -f $k, $a.$k.mae, $a.$k.expectedTotal, $a.$k.detectedTotal)
        }
    }
    $resp = $report.e2e.responsiveness
    if ($resp) {
        Write-Host ("Responsiveness: longest main-thread stall {0} ms (limit {1} ms) -> {2}" -f $resp.maxStallMs, $resp.limitMs, $(if ($resp.pass) { 'PASS' } else { 'FAIL' }))
    }
    if ($failed.Count -gt 0 -or $report.error -or ($resp -and -not $resp.pass)) { exit 1 }
} finally {
    if ($chrome) { Get-CimInstance Win32_Process -Filter "Name='$([IO.Path]::GetFileName($browser))'" | Where-Object { $_.CommandLine -like "*$profileName*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
    if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
