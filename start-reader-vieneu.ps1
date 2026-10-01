#requires -Version 7.4
$ErrorActionPreference = 'Stop'
if ($env:VIENEU_ENABLED -eq 'false') { return }
$repo = Join-Path $PSScriptRoot 'test/VieNeu-TTS'
$python = Join-Path $repo '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { return }
$env:VIENEU_API_URL = 'http://127.0.0.1:8000/v1'
try {
    $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 2
    if ($health.status -eq 'ok' -and $health.sample_rate -eq 48000 -and $health.backend) { Write-Host 'VieNeu đã chạy trên port 8000.'; return }
} catch {}
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8000 đang được dịch vụ khác sử dụng.' }
$logs = Join-Path $PSScriptRoot '.reader-deploy'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$oldPort = $env:PORT
$oldHost = $env:HOST
try {
    $env:PORT = '8000'; $env:HOST = '127.0.0.1'; $env:PYTHONUTF8 = '1'
    $env:VIENEU_BACKEND = 'onnx'; $env:VIENEU_PRECISION = 'int8'
    $process = Start-Process -FilePath $python -ArgumentList @('-m', 'apps.openai_speech') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'vieneu.stdout.log') -RedirectStandardError (Join-Path $logs 'vieneu.stderr.log')
} finally { $env:PORT = $oldPort; $env:HOST = $oldHost }
for ($i = 0; $i -lt 180; $i++) {
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 2
        if ($health.status -eq 'ok' -and $health.sample_rate -eq 48000 -and $health.backend) { Write-Host 'VieNeu sẵn sàng: Thiền Tâm Đức.'; return }
    } catch {}
    if ($process.HasExited) { throw 'VieNeu không khởi động được. Xem .reader-deploy/vieneu.stderr.log.' }
}
throw 'VieNeu đang tải model hoặc chưa sẵn sàng. Xem .reader-deploy/vieneu.stderr.log và chạy lại.'
