# Novel Reader — một script duy nhất, chạy tại thư mục Reader:
#   .\reader.ps1                     Dev: Go API (8081) + web Next.js (3000)
#   .\reader.ps1 -Tunnel             API riêng + Cloudflare Quick Tunnel (không deploy)
#   .\reader.ps1 -Publish            Như -Tunnel rồi cập nhật env + redeploy web trên Vercel
#   .\reader.ps1 -Restart -Publish   Sau khi sửa backend: build lại API đang chạy
# Máy mới tự cài PowerShell 7, Go, Node.js, Git, uv, cloudflared, Vercel CLI, Piper và VieNeu khi cần.
# Bị chặn ExecutionPolicy: powershell -ExecutionPolicy Bypass -File .\reader.ps1
# File phải giữ UTF-8 có BOM và cú pháp đọc được bằng Windows PowerShell 5.1 cho tới bước chuyển sang pwsh 7.
param(
    [switch]$Publish,
    [switch]$Tunnel,
    [switch]$Restart,
    [ValidateRange(1, 65535)][int]$Port = 8083,
    # Nội bộ: dọn binary/log cũ của chế độ tunnel (tests/cleanup-reader-home.Tests.ps1 gọi trực tiếp).
    [switch]$Cleanup,
    [string]$DeployDirectory,
    [switch]$RetireProcesses,
    [int]$PreviousPort,
    [int]$PreviousTunnelPid
)
$ErrorActionPreference = 'Stop'

function Update-Path {
    $env:Path = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), (Join-Path $env:APPDATA 'npm')) -join ';'
}

# Trả về đường dẫn lệnh, cài bằng winget nếu máy chưa có.
function Use-Tool([string]$Name, [string]$WingetId) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    Write-Host "Đang cài $Name ($WingetId)..."
    winget install --id $WingetId --exact --silent --accept-source-agreements --accept-package-agreements | Out-Host
    Update-Path
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { throw "Không cài được $Name. Cài thủ công (winget install $WingetId) rồi chạy lại." }
    return $command.Source
}

if ($PSVersionTable.PSVersion -lt [version]'7.4') {
    $pwsh = Use-Tool 'pwsh' 'Microsoft.PowerShell'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    foreach ($entry in $PSBoundParameters.GetEnumerator()) {
        if ($entry.Value -is [switch]) { if ($entry.Value) { $arguments += "-$($entry.Key)" } }
        else { $arguments += "-$($entry.Key)"; $arguments += [string]$entry.Value }
    }
    & $pwsh @arguments
    exit $LASTEXITCODE
}

$root = $PSScriptRoot
$work = Join-Path $root '.reader-deploy'

# Chỉ dọn binary/log cũ sau khi API và tunnel mới đã chạy; không bao giờ đụng process ngoài thư mục này.
function Invoke-DeployCleanup([string]$Directory, [switch]$Retire, [int]$OldPort, [int]$OldTunnelPid) {
    $work = (Get-Item -LiteralPath $Directory).FullName
    $state = Get-Content -LiteralPath (Join-Path $work 'state.json') -Raw | ConvertFrom-Json
    $credentials = Get-Content -LiteralPath (Join-Path $work 'credentials.json') -Raw | ConvertFrom-Json
    $headers = @{ 'X-Reader-Token' = $credentials.apiToken }
    if ((Invoke-RestMethod -Uri "http://127.0.0.1:$($state.port)/api/health" -Headers $headers -TimeoutSec 5).status -ne 'UP') {
        throw 'API hiện tại chưa sẵn sàng; không dọn tài nguyên cũ.'
    }
    if ($Retire -and (Invoke-RestMethod -Uri "$($state.tunnelUrl)/api/health" -Headers $headers -TimeoutSec 10).status -ne 'UP') {
        throw 'Tunnel hiện tại chưa sẵn sàng; không dừng process cũ.'
    }
    $activeBinary = Join-Path $work "reader-home-api-$($state.port).exe"
    $processes = @(Get-CimInstance Win32_Process)
    if ($activeBinary -notin @($processes | ForEach-Object { $_.ExecutablePath })) {
        throw 'Không xác nhận được process API hiện tại thuộc thư mục này; không dọn.'
    }
    if ($Retire) {
        foreach ($process in $processes) {
            if ($process.ExecutablePath -and (Split-Path $process.ExecutablePath) -eq $work -and
                $process.Name -match '^reader-home-api(?:-\d+)?\.exe$' -and $process.ExecutablePath -ne $activeBinary) {
                Stop-Process -Id $process.ProcessId -ErrorAction Stop
                Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
            }
            if ($OldPort -and $OldTunnelPid -and $process.ProcessId -eq $OldTunnelPid -and
                $process.ProcessId -ne $state.tunnelPid -and $process.Name -eq 'cloudflared.exe' -and
                $process.CommandLine -match "--url\s+`"?http://(?:127\.0\.0\.1|localhost):$OldPort(?:/)?(?:\s|`"|$)") {
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
}

if ($Cleanup) {
    if (-not $DeployDirectory) { $DeployDirectory = $work }
    Invoke-DeployCleanup $DeployDirectory -Retire:$RetireProcesses -OldPort $PreviousPort -OldTunnelPid $PreviousTunnelPid
    return
}

# Piper: piper.exe + 2 giọng Việt (~63MB/giọng), tự tải lần đầu. PIPER_ENABLED=false để bỏ qua.
function Initialize-Piper {
    if ($env:PIPER_ENABLED -eq 'false') { return }
    $piperDir = Join-Path $root 'tools\piper'
    $voicesDir = Join-Path $piperDir 'voices'
    $piperExe = Join-Path $piperDir 'piper.exe'
    $espeakDir = Join-Path $piperDir 'espeak-ng-data'
    $hfBase = 'https://huggingface.co/datasets/lamyaya88a/tts-ngochuyen-v1/resolve/main'
    New-Item -ItemType Directory -Path $voicesDir -Force | Out-Null
    if (-not (Test-Path $piperExe) -or -not (Test-Path $espeakDir)) {
        Write-Host 'Đang tải Piper...'
        $zipFile = Join-Path ([IO.Path]::GetTempPath()) 'piper_windows_amd64.zip'
        $tmpDir = Join-Path ([IO.Path]::GetTempPath()) 'piper_extract'
        Invoke-WebRequest -Uri 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' -OutFile $zipFile
        if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
        Expand-Archive -LiteralPath $zipFile -DestinationPath $tmpDir -Force
        $nested = Join-Path $tmpDir 'piper'
        $sourceDir = if (Test-Path $nested) { $nested } else { $tmpDir }
        Copy-Item -LiteralPath (Join-Path $sourceDir 'piper.exe') -Destination $piperExe -Force
        Copy-Item -LiteralPath (Join-Path $sourceDir 'espeak-ng-data') -Destination $piperDir -Recurse -Force
        foreach ($dll in @('espeak-ng.dll', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'piper_phonemize.dll')) {
            $src = Join-Path $sourceDir $dll
            if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $piperDir $dll) -Force }
        }
        Remove-Item -Force $zipFile
        Remove-Item -Recurse -Force $tmpDir
    }
    foreach ($name in @('duy_oryx.onnx', 'duy_oryx.onnx.json', 'ngoc_ngan.onnx', 'ngoc_ngan.onnx.json')) {
        $file = Join-Path $voicesDir $name
        $minimum = if ($name.EndsWith('.json')) { 1KB } else { 1MB }
        if ((Test-Path $file) -and (Get-Item $file).Length -ge $minimum) { continue }
        Write-Host "Đang tải model $name..."
        Invoke-WebRequest -Uri "$hfBase/$name" -OutFile $file
    }
    $env:PIPER_ENABLED = 'true'
    $env:PIPER_BIN = $piperExe
    $env:PIPER_ESPEAK_DATA = $espeakDir
    $env:PIPER_DUYORYX_MODEL = Join-Path $voicesDir 'duy_oryx.onnx'
    $env:PIPER_DUYORYX_CONFIG = Join-Path $voicesDir 'duy_oryx.onnx.json'
    $env:PIPER_NGOCNGAN_MODEL = Join-Path $voicesDir 'ngoc_ngan.onnx'
    $env:PIPER_NGOCNGAN_CONFIG = Join-Path $voicesDir 'ngoc_ngan.onnx.json'
}

function Test-VieNeuReady {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 2 } catch { return $false }
    if ($health.status -ne 'ok' -or $health.sample_rate -ne 48000 -or -not $health.backend) { return $false }
    # The Go API splits each chunk across this many streams (see go-api/vieneu.go).
    $env:VIENEU_MAX_STREAMS = [string]$health.max_streams
    Write-Host "VieNeu sẵn sàng trên port 8000: backend=$($health.backend), $($health.max_streams) luồng."
    return $true
}

# VieNeu: server Python local ở 127.0.0.1:8000. Máy mới tự clone + uv sync (bản CUDA nếu có card NVIDIA).
function Start-VieNeu {
    if ($env:VIENEU_ENABLED -eq 'false') { return }
    $env:VIENEU_API_URL = 'http://127.0.0.1:8000/v1'
    if (Test-VieNeuReady) { return }
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8000 đang được dịch vụ khác sử dụng.' }
    $repo = Join-Path $root 'test\VieNeu-TTS'
    if (-not (Test-Path (Join-Path $repo 'pyproject.toml'))) {
        $git = Use-Tool 'git' 'Git.Git'
        Write-Host 'Đang tải VieNeu-TTS...'
        & $git clone --quiet https://github.com/pnnbao97/VieNeu-TTS.git $repo
        # Commit đã kiểm tra với /health (sample_rate, max_streams) mà Go API cần.
        if ($LASTEXITCODE -eq 0) { & $git -C $repo checkout --quiet 8534432 }
        if ($LASTEXITCODE -ne 0) { throw 'Không tải được VieNeu-TTS.' }
    }
    $python = Join-Path $repo '.venv\Scripts\python.exe'
    # Cài lại khi .venv hỏng (chép/đồng bộ từ máy khác trỏ tới Python không tồn tại),
    # hoặc khi máy có card NVIDIA mà .venv chưa có PyTorch CUDA (VIENEU_BACKEND=onnx để giữ CPU).
    $gpu = $env:VIENEU_BACKEND -ne 'onnx' -and [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue)
    $check = if ($gpu) { 'import vieneu, torch; assert torch.cuda.is_available()' } else { 'import vieneu' }
    $healthyVenv = $false
    if (Test-Path $python) {
        Push-Location $repo
        try { & $python -c $check 2>$null; $healthyVenv = $LASTEXITCODE -eq 0 } catch {} finally { Pop-Location }
    }
    if (-not $healthyVenv) {
        $uv = Use-Tool 'uv' 'astral-sh.uv'
        $extra = if ($gpu) { @('--extra', 'cuda') } else { @() }
        Write-Host "Đang cài môi trường VieNeu (uv sync $extra), lần đầu có thể mất vài phút..."
        Push-Location $repo
        try { & $uv sync --frozen @extra; if ($LASTEXITCODE -ne 0) { throw 'uv sync thất bại.' } } finally { Pop-Location }
    }
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    # GPU (uv sync --extra cuda): one stream runs at about real time, but 8 run at once,
    # so a chunk is ready roughly 6x sooner than on CPU. VIENEU_BACKEND=onnx forces CPU.
    $backend = $env:VIENEU_BACKEND
    if (-not $backend) {
        $cuda = & $python -c "import importlib.util as u; print(bool(u.find_spec('torch')) and __import__('torch').cuda.is_available())" 2>$null
        $backend = if ($cuda -eq 'True') { 'auto' } else { 'onnx' }
    }
    $oldPort = $env:PORT; $oldHost = $env:HOST; $oldBackend = $env:VIENEU_BACKEND
    try {
        $env:PORT = '8000'; $env:HOST = '127.0.0.1'; $env:PYTHONUTF8 = '1'
        $env:VIENEU_BACKEND = $backend
        # CPU serves one stream; more would only share the same cores.
        $env:VIENEU_MAX_STREAMS = if ($backend -eq 'onnx') { '1' } else { '8' }
        # int8 can distort audio on CPUs without VNNI; opt in with VIENEU_PRECISION=int8.
        if (-not $env:VIENEU_PRECISION) { $env:VIENEU_PRECISION = 'fp32' }
        $process = Start-Process -FilePath $python -ArgumentList @('-m', 'apps.openai_speech') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work 'vieneu.stdout.log') -RedirectStandardError (Join-Path $work 'vieneu.stderr.log')
    } finally { $env:PORT = $oldPort; $env:HOST = $oldHost; $env:VIENEU_BACKEND = $oldBackend }
    # Lần đầu VieNeu tải model từ HuggingFace nên chờ lâu hơn.
    for ($i = 0; $i -lt 600; $i++) {
        Start-Sleep -Seconds 1
        if (Test-VieNeuReady) { return }
        if ($process.HasExited) { throw 'VieNeu không khởi động được. Xem .reader-deploy/vieneu.stderr.log.' }
    }
    throw 'VieNeu chưa sẵn sàng sau 10 phút. Xem .reader-deploy/vieneu.stderr.log.'
}

function Test-ApiHealth([string]$Url, [hashtable]$Headers, [int]$Timeout = 2) {
    try { return (Invoke-RestMethod -Uri "$Url/api/health" -Headers $Headers -TimeoutSec $Timeout).status -eq 'UP' } catch { return $false }
}

# --- Chuẩn bị chung ---
Update-Path
$envFile = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Thiếu file .env. Chép .env.example thành .env rồi điền MONGODB_URI.' }
foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim('"').Trim("'")
    }
}
if ([string]::IsNullOrWhiteSpace($env:MONGODB_URI)) { throw 'Thiếu MONGODB_URI trong .env.' }
$go = Use-Tool 'go' 'GoLang.Go'
Initialize-Piper
try { Start-VieNeu } catch {
    Remove-Item Env:VIENEU_API_URL -ErrorAction SilentlyContinue
    Write-Warning "Chạy tiếp không có giọng VieNeu: $($_.Exception.Message)"
}

if (-not ($Tunnel -or $Publish)) {
    # --- Dev: Go API + Next.js, mỗi cái một cửa sổ (kế thừa biến môi trường ở trên) ---
    $listener = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        throw "Cổng 8081 đang được dùng bởi PID $($listener.OwningProcess) ($(if ($owner) { $owner.ProcessName } else { 'unknown' })). Đóng process đó rồi chạy lại."
    }
    $npm = Use-Tool 'npm.cmd' 'OpenJS.NodeJS.LTS'
    $webPath = Join-Path $root 'web'
    if (-not (Test-Path (Join-Path $webPath 'node_modules'))) {
        Push-Location $webPath
        try { & $npm install; if ($LASTEXITCODE -ne 0) { throw 'Không cài được dependency cho web.' } } finally { Pop-Location }
    }
    $env:NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8081/api'
    $env:AUTO_MIGRATE = 'true'
    $env:PORT = '8081'
    Start-Process pwsh -WorkingDirectory (Join-Path $root 'go-api') -ArgumentList @('-NoExit', '-NoProfile', '-Command', "& '$go' run ./cmd/local")
    $env:PORT = '3000'
    Start-Process pwsh -WorkingDirectory $webPath -ArgumentList @('-NoExit', '-NoProfile', '-Command', "& '$npm' run dev")
    Write-Host 'Go API: http://localhost:8081/api/health'
    Write-Host 'Web: http://localhost:3000/library'
    return
}

# --- Tunnel/Publish: API riêng có token + Cloudflare Quick Tunnel (+ Vercel) ---
New-Item -ItemType Directory -Force -Path $work | Out-Null
$statePath = Join-Path $work 'state.json'
if (-not $PSBoundParameters.ContainsKey('Port') -and (Test-Path -LiteralPath $statePath)) {
    $savedPort = (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json).port
    if ($savedPort -ge 1 -and $savedPort -le 65535) { $Port = [int]$savedPort }
}
$credentialsPath = Join-Path $work 'credentials.json'
if (-not (Test-Path -LiteralPath $credentialsPath)) {
    $credentials = @{ username = 'reader'; password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)); apiToken = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) }
    $credentials | ConvertTo-Json | Set-Content -LiteralPath $credentialsPath -Encoding utf8
}
$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
@('Website: https://web-reader-six.vercel.app', 'Username: reader', "Password: $($credentials.password)") | Set-Content -LiteralPath (Join-Path $work 'login.txt') -Encoding utf8
$env:PORT = [string]$Port
$env:READER_ACCESS_TOKEN = $credentials.apiToken
$localApiUrl = "http://127.0.0.1:$Port"
$headers = @{ 'X-Reader-Token' = $credentials.apiToken }
$healthy = Test-ApiHealth $localApiUrl $headers
if ($Restart -and $healthy) {
    $pidPath = Join-Path $work 'api.pid'
    if (-not (Test-Path -LiteralPath $pidPath)) { throw 'Không tìm thấy PID của API do script quản lý.' }
    $managedPid = [int](Get-Content -LiteralPath $pidPath)
    $managed = Get-CimInstance Win32_Process -Filter "ProcessId=$managedPid"
    $expected = Join-Path $work "reader-home-api-$Port.exe"
    if (-not $managed -or $managed.ExecutablePath -ne $expected) { throw 'API không thuộc script này; không tự dừng process khác.' }
    Stop-Process -Id $managedPid
    $healthy = $false
}
if (-not $healthy) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port đã được dùng bởi process khác. Không tự dừng process." }
    $binary = Join-Path $work "reader-home-api-$Port.exe"
    Push-Location (Join-Path $root 'go-api')
    try { & $go build -o $binary ./cmd/local; if ($LASTEXITCODE -ne 0) { throw 'Build Go API thất bại.' } } finally { Pop-Location }
    $api = Start-Process -FilePath $binary -WorkingDirectory (Join-Path $root 'go-api') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work 'api.stdout.log') -RedirectStandardError (Join-Path $work 'api.stderr.log')
    $api.Id | Set-Content -LiteralPath (Join-Path $work 'api.pid')
    for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
        Start-Sleep -Seconds 1
        $healthy = Test-ApiHealth $localApiUrl $headers
        if (-not $healthy -and $api.HasExited) { throw 'API không khởi động được. Xem .reader-deploy/api.stderr.log.' }
    }
    if (-not $healthy) { throw 'API chưa sẵn sàng. Xem .reader-deploy/api.stderr.log.' }
}
$tunnelUrl = $null
$previous = $null
if (Test-Path -LiteralPath $statePath) {
    $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $process = Get-Process -Id $previous.tunnelPid -ErrorAction SilentlyContinue
    if ($previous.port -eq $Port -and $process -and $process.ProcessName -eq 'cloudflared' -and (Test-ApiHealth $previous.tunnelUrl $headers 10)) {
        $tunnelUrl = $previous.tunnelUrl
    }
}
if (-not $tunnelUrl) {
    $cloudflared = Use-Tool 'cloudflared' 'Cloudflare.cloudflared'
    $log = Join-Path $work "tunnel-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).log"
    # A user's named-tunnel config may contain a catch-all 404 ingress. Isolate
    # this account-less Quick Tunnel so its hostname forwards to the local API.
    # Kept outside OneDrive: a cloud-only placeholder makes cloudflared time out reading it.
    $quickTunnelConfig = Join-Path ([IO.Path]::GetTempPath()) 'reader-quick-tunnel-config.yml'
    Set-Content -LiteralPath $quickTunnelConfig -Value 'no-autoupdate: true' -Encoding ascii
    $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--config', $quickTunnelConfig, '--url', $localApiUrl) -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput "$log.stdout"
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if ((Test-Path -LiteralPath $log) -and (Get-Content -LiteralPath $log -Raw) -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $tunnelUrl = $Matches[0]; break }
        if ($tunnel.HasExited) { throw "Tunnel không khởi động được. Xem $log" }
    }
    if (-not $tunnelUrl) { throw "Không nhận được URL tunnel. Xem $log" }
    @{ tunnelUrl = $tunnelUrl; tunnelPid = $tunnel.Id; port = $Port } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}
Write-Host "API tunnel: $tunnelUrl (được bảo vệ bằng token)"
Write-Host "Tài khoản web nằm trong: $(Join-Path $work 'login.txt')"
if ($Publish) {
    $npm = Use-Tool 'npm.cmd' 'OpenJS.NodeJS.LTS'
    if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
        & $npm install -g vercel; if ($LASTEXITCODE -ne 0) { throw 'Không cài được Vercel CLI.' }
        Update-Path
    }
    $webPath = Join-Path $root 'web'
    Push-Location $webPath
    try {
        vercel whoami 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { vercel login; if ($LASTEXITCODE -ne 0) { throw 'Chưa đăng nhập được Vercel.' } }
        if (-not (Test-Path (Join-Path $webPath '.vercel\project.json'))) {
            vercel link --yes --project web-reader; if ($LASTEXITCODE -ne 0) { throw 'Không link được project Vercel web-reader.' }
        }
        $variables = @{ NEXT_PUBLIC_API_BASE_URL = '/api'; API_INTERNAL_URL = "$tunnelUrl/api"; API_ACCESS_TOKEN = $credentials.apiToken; READER_WEB_PASSWORD = $credentials.password }
        foreach ($name in @('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
            $value = [Environment]::GetEnvironmentVariable($name)
            if ($value) { $variables[$name] = $value }
        }
        $cli = Join-Path (Split-Path (Get-Command vercel).Source) 'node_modules/vercel/dist/index.js'
        foreach ($name in $variables.Keys) {
            # Write stdin without PowerShell's trailing newline; never put secrets in argv.
            $info = [Diagnostics.ProcessStartInfo]::new()
            $info.FileName = (Get-Command node).Source
            foreach ($argument in @($cli, 'env', 'add', $name, 'production', '--force', '--yes')) { $info.ArgumentList.Add($argument) }
            if ($name -in @('API_ACCESS_TOKEN', 'READER_WEB_PASSWORD')) { $info.ArgumentList.Add('--sensitive') }
            $info.UseShellExecute = $false
            $info.CreateNoWindow = $true
            $info.RedirectStandardInput = $true
            $info.WorkingDirectory = $webPath
            $process = [Diagnostics.Process]::Start($info)
            $process.StandardInput.Write([string]$variables[$name])
            $process.StandardInput.Close()
            $process.WaitForExit()
            if ($process.ExitCode -ne 0) { throw "Không cập nhật được biến $name trên Vercel." }
        }
        vercel deploy --prod --yes
        if ($LASTEXITCODE -ne 0) { throw 'Deploy Vercel thất bại.' }
    } finally { Pop-Location }
}

# Only retire running backends/tunnels after the production website has switched.
try {
    Invoke-DeployCleanup $work -Retire:$Publish -OldPort $previous.port -OldTunnelPid $previous.tunnelPid
} catch { Write-Warning "Chưa dọn được tài nguyên cũ: $($_.Exception.Message)" }
