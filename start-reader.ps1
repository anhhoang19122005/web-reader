# Chạy từ PowerShell tại thư mục Reader:
#   .\start-reader.ps1
# Nếu dùng Saydi, đặt key trước khi chạy:
#   $env:SAYDI_API_KEY = "sv_live_..."

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiPath = Join-Path $root "api"
$webPath = Join-Path $root "web"
$env:EDGE_TTS_ENABLED = "false"

docker compose --project-directory $root up -d
if ($LASTEXITCODE -ne 0) {
    throw "Không thể khởi động PostgreSQL bằng Docker Compose."
}

if ([string]::IsNullOrWhiteSpace($env:SAYDI_API_KEY)) {
    $envFile = Join-Path $root ".env"
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^\s*SAYDI_API_KEY\s*=' } | Select-Object -First 1
        if ($line -match '^\s*SAYDI_API_KEY\s*=\s*(.*)\s*$') {
            $env:SAYDI_API_KEY = $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
}

if ([string]::IsNullOrWhiteSpace($env:SAYDI_API_KEY)) {
    Write-Warning "SAYDI_API_KEY chưa được đặt; API sẽ chỉ hiện giọng mock."
}

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    $env:EDGE_TTS_PYTHON = $python.Source
    & $python.Source -m pip show edge-tts *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Đang cài edge-tts miễn phí..."
        & $python.Source -m pip install edge-tts
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Không cài được edge-tts; API vẫn chạy nhưng chỉ dùng provider khác."
        }
    }
    & $python.Source -m pip show edge-tts *> $null
    if ($LASTEXITCODE -eq 0) {
        $env:EDGE_TTS_ENABLED = "true"
    }
} else {
    Write-Warning "Chưa tìm thấy Python; Edge-TTS sẽ không khả dụng."
}

Start-Process powershell.exe `
    -WorkingDirectory $apiPath `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", ".\mvnw.cmd spring-boot:run")

Start-Process powershell.exe `
    -WorkingDirectory $webPath `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "npm run dev")

Write-Host "API: http://localhost:8080/api/health"
Write-Host "Web: http://localhost:3000/library"
