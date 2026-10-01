# Chạy backend Go (MongoDB Atlas) và Next.js tại thư mục Reader:
#   .\start-reader-go.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$goApiPath = Join-Path $root "go-api"
$webPath = Join-Path $root "web"
$go = Get-Command go -ErrorAction SilentlyContinue

if ($go) {
    $goExecutable = $go.Source
} else {
    Write-Host "Đang cài Go..."
    winget install --id GoLang.Go --exact --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "Không cài được Go bằng winget." }
    $goPath = "C:\Program Files\Go\bin\go.exe"
    if (-not (Test-Path $goPath)) { throw "Không tìm thấy Go sau khi cài." }
    $goExecutable = $goPath
}

$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim('"').Trim("'")
        }
    }
}

$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:8081/api"

# --- Giọng local offline (Piper + 2 voice Việt miễn phí, cộng thêm) ---
# Chỉ cài ở local; deploy Vercel đặt PIPER_ENABLED=false nên bỏ qua khối này.
$piperEnabled = $env:PIPER_ENABLED
if ([string]::IsNullOrWhiteSpace($piperEnabled)) { $piperEnabled = "true" }
$piperDir = Join-Path $root "tools\piper"
$voicesDir = Join-Path $piperDir "voices"
$piperExe = Join-Path $piperDir "piper.exe"
$espeakDir = Join-Path $piperDir "espeak-ng-data"
if ($piperEnabled -ne "false") {
    $piperZipUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
    $hfBase = "https://huggingface.co/datasets/lamyaya88a/tts-ngochuyen-v1/resolve/main"
    $wantedModels = @("duy_oryx.onnx", "duy_oryx.onnx.json", "ngoc_ngan.onnx", "ngoc_ngan.onnx.json")
    $needPiper = (-not (Test-Path $piperExe)) -or (-not (Test-Path $espeakDir))
    $needModels = $false
    foreach ($name in $wantedModels) {
        $file = Join-Path $voicesDir $name
        if (-not (Test-Path $file)) { $needModels = $true; break }
        if ((Get-Item $file).Length -lt 1MB) { $needModels = $true; break }
    }
    if ($needPiper -or $needModels) {
        Write-Host "Đang chuẩn bị giọng local offline (Piper)..."
        New-Item -ItemType Directory -Path $voicesDir -Force | Out-Null
        if ($needPiper) {
            $zipFile = Join-Path ([System.IO.Path]::GetTempPath()) "piper_windows_amd64.zip"
            Invoke-WebRequest -Uri $piperZipUrl -OutFile $zipFile
            $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "piper_extract"
            if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
            Expand-Archive -LiteralPath $zipFile -DestinationPath $tmpDir -Force
            $nested = Join-Path $tmpDir "piper"
            $sourceDir = if (Test-Path $nested) { $nested } else { $tmpDir }
            Copy-Item -LiteralPath (Join-Path $sourceDir "piper.exe") -Destination $piperExe -Force
            Copy-Item -LiteralPath (Join-Path $sourceDir "espeak-ng-data") -Destination $piperDir -Recurse -Force
            foreach ($dll in @("espeak-ng.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll", "piper_phonemize.dll")) {
                $src = Join-Path $sourceDir $dll
                if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $piperDir $dll) -Force }
            }
            Remove-Item -Force $zipFile
            Remove-Item -Recurse -Force $tmpDir
        }
        foreach ($name in $wantedModels) {
            $file = Join-Path $voicesDir $name
            if ((Test-Path $file) -and (Get-Item $file).Length -ge 1MB) { continue }
            Write-Host "Đang tải model $name (~63MB)..."
            Invoke-WebRequest -Uri "$hfBase/$name" -OutFile $file
        }
        if (-not (Test-Path $piperExe)) { throw "Không cài được Piper local (thiếu piper.exe)." }
    }
    $env:PIPER_ENABLED = "true"
    $env:PIPER_BIN = $piperExe
    $env:PIPER_ESPEAK_DATA = $espeakDir
    $env:PIPER_DUYORYX_MODEL = Join-Path $voicesDir "duy_oryx.onnx"
    $env:PIPER_DUYORYX_CONFIG = Join-Path $voicesDir "duy_oryx.onnx.json"
    $env:PIPER_NGOCNGAN_MODEL = Join-Path $voicesDir "ngoc_ngan.onnx"
    $env:PIPER_NGOCNGAN_CONFIG = Join-Path $voicesDir "ngoc_ngan.onnx.json"
} else {
    $env:PIPER_ENABLED = "false"
}

if ([string]::IsNullOrWhiteSpace($env:MONGODB_URI)) {
    throw "Thiếu MONGODB_URI. Hãy đặt connection string MongoDB Atlas trong file .env ở thư mục Reader."
}

$apiConnection = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($apiConnection) {
    $apiProcess = Get-Process -Id $apiConnection.OwningProcess -ErrorAction SilentlyContinue
    $apiProcessName = if ($apiProcess) { $apiProcess.ProcessName } else { "unknown" }
    throw "Cổng 8081 đang được dùng bởi PID $($apiConnection.OwningProcess) ($apiProcessName). Hãy đóng process đó rồi chạy lại script."
}

if (-not (Test-Path (Join-Path $webPath "node_modules"))) {
    Push-Location $webPath
    npm.cmd install
    $npmExitCode = $LASTEXITCODE
    Pop-Location
    if ($npmExitCode -ne 0) { throw "Không cài được dependency cho web." }
}

Start-Process powershell.exe `
    -WorkingDirectory $goApiPath `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "`$env:PORT='8081'; `$env:AUTO_MIGRATE='true'; `$env:PIPER_ENABLED='$($env:PIPER_ENABLED)'; `$env:PIPER_BIN='$($env:PIPER_BIN)'; `$env:PIPER_ESPEAK_DATA='$($env:PIPER_ESPEAK_DATA)'; `$env:PIPER_DUYORYX_MODEL='$($env:PIPER_DUYORYX_MODEL)'; `$env:PIPER_DUYORYX_CONFIG='$($env:PIPER_DUYORYX_CONFIG)'; `$env:PIPER_NGOCNGAN_MODEL='$($env:PIPER_NGOCNGAN_MODEL)'; `$env:PIPER_NGOCNGAN_CONFIG='$($env:PIPER_NGOCNGAN_CONFIG)'; & '$goExecutable' run ./cmd/local")

Start-Process powershell.exe `
    -WorkingDirectory $webPath `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "`$env:PORT='3000'; npm.cmd run dev")

Write-Host "Go API: http://localhost:8081/api/health"
Write-Host "Web: http://localhost:3000/library"
