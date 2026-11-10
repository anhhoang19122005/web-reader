#requires -Version 7.4
$ErrorActionPreference = 'Stop'
if ($env:VIENEU_ENABLED -eq 'false') { return }
$repo = Join-Path $PSScriptRoot 'test/VieNeu-TTS'
$python = Join-Path $repo '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { return }
$env:VIENEU_API_URL = 'http://127.0.0.1:8000/v1'
function Test-VieNeuReady {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 2 } catch { return $false }
    if ($health.status -ne 'ok' -or $health.sample_rate -ne 48000 -or -not $health.backend) { return $false }
    # The Go API splits each chunk across this many streams (see go-api/vieneu.go).
    $env:VIENEU_MAX_STREAMS = [string]$health.max_streams
    Write-Host "VieNeu sẵn sàng trên port 8000: backend=$($health.backend), $($health.max_streams) luồng."
    return $true
}
if (Test-VieNeuReady) { return }
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8000 đang được dịch vụ khác sử dụng.' }
$logs = Join-Path $PSScriptRoot '.reader-deploy'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
# GPU (uv sync --extra cuda): one stream runs at about real time, but 8 run at once,
# so a chunk is ready roughly 6x sooner than on CPU. VIENEU_BACKEND=onnx forces CPU.
$backend = $env:VIENEU_BACKEND
if (-not $backend) {
    $cuda = & $python -c "import importlib.util as u; print(bool(u.find_spec('torch')) and __import__('torch').cuda.is_available())" 2>$null
    $backend = if ($cuda -eq 'True') { 'auto' } else { 'onnx' }
}
$oldPort = $env:PORT
$oldHost = $env:HOST
$oldBackend = $env:VIENEU_BACKEND
try {
    $env:PORT = '8000'; $env:HOST = '127.0.0.1'; $env:PYTHONUTF8 = '1'
    $env:VIENEU_BACKEND = $backend
    # CPU serves one stream; more would only share the same cores.
    $env:VIENEU_MAX_STREAMS = if ($backend -eq 'onnx') { '1' } else { '8' }
    # int8 can distort audio on CPUs without VNNI; opt in with VIENEU_PRECISION=int8.
    if (-not $env:VIENEU_PRECISION) { $env:VIENEU_PRECISION = 'fp32' }
    $process = Start-Process -FilePath $python -ArgumentList @('-m', 'apps.openai_speech') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'vieneu.stdout.log') -RedirectStandardError (Join-Path $logs 'vieneu.stderr.log')
} finally { $env:PORT = $oldPort; $env:HOST = $oldHost; $env:VIENEU_BACKEND = $oldBackend }
for ($i = 0; $i -lt 180; $i++) {
    Start-Sleep -Seconds 1
    if (Test-VieNeuReady) { return }
    if ($process.HasExited) { throw 'VieNeu không khởi động được. Xem .reader-deploy/vieneu.stderr.log.' }
}
throw 'VieNeu đang tải model hoặc chưa sẵn sàng. Xem .reader-deploy/vieneu.stderr.log và chạy lại.'
