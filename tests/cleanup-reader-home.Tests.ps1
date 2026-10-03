#requires -Version 7.4
# Run: pwsh -NoProfile -File tests/cleanup-reader-home.Tests.ps1
$ErrorActionPreference = 'Stop'
$cleanupScript = Join-Path (Split-Path $PSScriptRoot) 'cleanup-reader-home.ps1'
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) "reader-cleanup-test-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $testDirectory | Out-Null
function Assert($condition, $message) { if (!$condition) { throw $message } }
function Get-CimInstance { param($ClassName) $global:readerCleanupTestProcesses }
function Invoke-RestMethod { param($Uri, $Headers, $TimeoutSec) @{ status = $global:readerCleanupTestHealth } }
function Stop-Process {
    param($Id, $ErrorAction)
    $global:readerCleanupTestStopped += $Id
    $global:readerCleanupTestProcesses = @($global:readerCleanupTestProcesses | Where-Object { $_.ProcessId -ne $Id })
}
function Wait-Process { param($Id, $Timeout, $ErrorAction) }
function Set-Fixture {
    $global:readerCleanupTestHealth = 'UP'
    $global:readerCleanupTestStopped = @()
    @{ port = 8088; tunnelPid = 20; tunnelUrl = 'https://active.example' } | ConvertTo-Json | Set-Content (Join-Path $testDirectory 'state.json')
    @{ apiToken = 'test-only' } | ConvertTo-Json | Set-Content (Join-Path $testDirectory 'credentials.json')
    foreach ($name in 'reader-home-api.exe','reader-home-api-8087.exe','reader-home-api-8088.exe','book.epub','api.stderr.log') {
        Set-Content -LiteralPath (Join-Path $testDirectory $name) -Value 'keep or remove only by ownership'
    }
    Set-Content -LiteralPath (Join-Path $testDirectory 'tunnel-1.log') -Value 'https://old.example'
    Set-Content -LiteralPath (Join-Path $testDirectory 'tunnel-1.log.stdout') -Value ''
    Set-Content -LiteralPath (Join-Path $testDirectory 'tunnel-2.log') -Value 'https://active.example'
    Set-Content -LiteralPath (Join-Path $testDirectory 'tunnel-2.log.stdout') -Value ''
    $global:readerCleanupTestProcesses = @(
        [pscustomobject]@{ ProcessId = 10; Name = 'reader-home-api-8088.exe'; ExecutablePath = (Join-Path $testDirectory 'reader-home-api-8088.exe'); CommandLine = '' },
        [pscustomobject]@{ ProcessId = 11; Name = 'reader-home-api-8087.exe'; ExecutablePath = (Join-Path $testDirectory 'reader-home-api-8087.exe'); CommandLine = '' },
        [pscustomobject]@{ ProcessId = 12; Name = 'reader-home-api-8087.exe'; ExecutablePath = 'C:\other-project\reader-home-api-8087.exe'; CommandLine = '' },
        [pscustomobject]@{ ProcessId = 20; Name = 'cloudflared.exe'; ExecutablePath = 'C:\tools\cloudflared.exe'; CommandLine = 'cloudflared tunnel --url http://127.0.0.1:8088' },
        [pscustomobject]@{ ProcessId = 21; Name = 'cloudflared.exe'; ExecutablePath = 'C:\tools\cloudflared.exe'; CommandLine = 'cloudflared tunnel --url http://127.0.0.1:8087' }
    )
}
try {
    Set-Fixture
    & $cleanupScript -DeployDirectory $testDirectory
    Assert ($global:readerCleanupTestStopped.Count -eq 0) 'Cleanup without publish stopped running processes'
    Assert (Test-Path (Join-Path $testDirectory 'reader-home-api-8087.exe')) 'Running old backend was deleted before publish'
    Assert (!(Test-Path (Join-Path $testDirectory 'reader-home-api.exe'))) 'Unused legacy binary was retained'
    Assert (Test-Path (Join-Path $testDirectory 'tunnel-1.log')) 'Logs were deleted while another tunnel was running'

    Set-Fixture
    & $cleanupScript -DeployDirectory $testDirectory -RetireProcesses -PreviousPort 8087 -PreviousTunnelPid 21
    Assert (($global:readerCleanupTestStopped | Sort-Object) -join ',' -eq '11,21') 'Cleanup stopped wrong processes'
    Assert (!(Test-Path (Join-Path $testDirectory 'reader-home-api-8087.exe'))) 'Old binary was retained after publish'
    Assert (!(Test-Path (Join-Path $testDirectory 'tunnel-1.log'))) 'Old tunnel log was retained'
    foreach ($name in 'reader-home-api-8088.exe','tunnel-2.log','tunnel-2.log.stdout','state.json','credentials.json','book.epub','api.stderr.log') {
        Assert (Test-Path (Join-Path $testDirectory $name)) "Deleted protected file: $name"
    }

    Set-Fixture
    $global:readerCleanupTestHealth = 'DOWN'
    $blocked = $false
    try { & $cleanupScript -DeployDirectory $testDirectory -RetireProcesses } catch { $blocked = $true }
    Assert $blocked 'Unhealthy replacement did not block cleanup'
    Assert ($global:readerCleanupTestStopped.Count -eq 0) 'Unhealthy replacement stopped old processes'
    Assert (Test-Path (Join-Path $testDirectory 'reader-home-api.exe')) 'Unhealthy replacement deleted old binary'
    Write-Host 'PASS: inactive files cleaned, active/foreign processes and data preserved, retire only after publish, unhealthy replacement blocks cleanup.'
} finally {
    $resolvedTestDirectory = (Resolve-Path -LiteralPath $testDirectory).Path
    if ($resolvedTestDirectory -ne $testDirectory -or (Split-Path $resolvedTestDirectory -Leaf) -notlike 'reader-cleanup-test-*') { throw 'Unexpected test cleanup path' }
    Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force
}
