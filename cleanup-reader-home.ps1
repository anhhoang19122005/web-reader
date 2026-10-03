#requires -Version 7.4
param(
    [string]$DeployDirectory = (Join-Path $PSScriptRoot '.reader-deploy'),
    [switch]$RetireProcesses,
    [int]$PreviousPort,
    [int]$PreviousTunnelPid
)
$ErrorActionPreference = 'Stop'
$work = (Get-Item -LiteralPath $DeployDirectory).FullName
$state = Get-Content -LiteralPath (Join-Path $work 'state.json') -Raw | ConvertFrom-Json
$credentials = Get-Content -LiteralPath (Join-Path $work 'credentials.json') -Raw | ConvertFrom-Json
$headers = @{ 'X-Reader-Token' = $credentials.apiToken }
if ((Invoke-RestMethod -Uri "http://127.0.0.1:$($state.port)/api/health" -Headers $headers -TimeoutSec 5).status -ne 'UP') {
    throw 'API hiện tại chưa sẵn sàng; không dọn tài nguyên cũ.'
}
if ($RetireProcesses -and (Invoke-RestMethod -Uri "$($state.tunnelUrl)/api/health" -Headers $headers -TimeoutSec 10).status -ne 'UP') {
    throw 'Tunnel hiện tại chưa sẵn sàng; không dừng process cũ.'
}
$activeBinary = Join-Path $work "reader-home-api-$($state.port).exe"
$processes = @(Get-CimInstance Win32_Process)
if ($activeBinary -notin @($processes | ForEach-Object { $_.ExecutablePath })) {
    throw 'Không xác nhận được process API hiện tại thuộc thư mục này; không dọn.'
}
if ($RetireProcesses) {
    foreach ($process in $processes) {
        if ($process.ExecutablePath -and (Split-Path $process.ExecutablePath) -eq $work -and
            $process.Name -match '^reader-home-api(?:-\d+)?\.exe$' -and $process.ExecutablePath -ne $activeBinary) {
            Stop-Process -Id $process.ProcessId -ErrorAction Stop
            Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        }
        if ($PreviousPort -and $PreviousTunnelPid -and $process.ProcessId -eq $PreviousTunnelPid -and
            $process.ProcessId -ne $state.tunnelPid -and $process.Name -eq 'cloudflared.exe' -and
            $process.CommandLine -match "--url\s+`"?http://(?:127\.0\.0\.1|localhost):$PreviousPort(?:/)?(?:\s|`"|$)") {
            Stop-Process -Id $process.ProcessId -ErrorAction Stop
            Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        }
    }
    $processes = @(Get-CimInstance Win32_Process)
}
$runningPaths = @($processes | ForEach-Object { $_.ExecutablePath })
$files = @(Get-ChildItem -LiteralPath $work -File | Where-Object {
    $_.Name -match '^reader-home-api(?:-\d+)?\.exe$' -and $_.FullName -ne $activeBinary -and $_.FullName -notin $runningPaths
})
# Preserve logs when another tunnel is still running; its website may still use it.
$otherTunnels = @($processes | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.ProcessId -ne $state.tunnelPid })
if (!$otherTunnels.Count -and $state.tunnelUrl) {
    foreach ($log in Get-ChildItem -LiteralPath $work -File | Where-Object { $_.Name -match '^tunnel-\d+\.log$' }) {
        if (!([string](Get-Content -LiteralPath $log.FullName -Raw)).Contains([string]$state.tunnelUrl)) {
            $files += $log
            $stdout = "$($log.FullName).stdout"
            if (Test-Path -LiteralPath $stdout) { $files += Get-Item -LiteralPath $stdout }
        }
    }
}
$removedBytes = 0L
$removedCount = 0
foreach ($file in $files) {
    # OneDrive files can be reparse points without being symbolic links.
    if ($file.DirectoryName -ne $work -or $file.LinkType) { continue }
    try {
        Remove-Item -LiteralPath $file.FullName -ErrorAction Stop
        $removedBytes += $file.Length
        $removedCount++
    } catch { Write-Warning "Giữ lại $($file.Name): $($_.Exception.Message)" }
}
Write-Host ('Đã dọn {0} file cũ, giải phóng {1:N2} MiB; giữ API cổng {2}.' -f $removedCount, ($removedBytes / 1MB), $state.port)
