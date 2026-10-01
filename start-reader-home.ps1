#requires -Version 7.4
param([switch]$Publish, [ValidateRange(1, 65535)][int]$Port = 8083)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$work = Join-Path $root '.reader-deploy'
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
foreach ($line in Get-Content -LiteralPath (Join-Path $root '.env')) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim('"').Trim("'")
    }
}
$env:PORT = [string]$Port
$localApiUrl = "http://127.0.0.1:$Port"
$env:READER_ACCESS_TOKEN = $credentials.apiToken
$env:PIPER_ENABLED = 'true'
$env:PIPER_BIN = Join-Path $root 'tools/piper/piper.exe'
$env:PIPER_ESPEAK_DATA = Join-Path $root 'tools/piper/espeak-ng-data'
$env:PIPER_DUYORYX_MODEL = Join-Path $root 'tools/piper/voices/duy_oryx.onnx'
$env:PIPER_DUYORYX_CONFIG = Join-Path $root 'tools/piper/voices/duy_oryx.onnx.json'
$env:PIPER_NGOCNGAN_MODEL = Join-Path $root 'tools/piper/voices/ngoc_ngan.onnx'
$env:PIPER_NGOCNGAN_CONFIG = Join-Path $root 'tools/piper/voices/ngoc_ngan.onnx.json'
if (-not (Test-Path -LiteralPath $env:PIPER_BIN)) { throw 'Chạy start-reader-go.ps1 trước để cài Piper.' }
$headers = @{ 'X-Reader-Token' = $credentials.apiToken }
$healthy = $false
try { $healthy = (Invoke-RestMethod -Uri "$localApiUrl/api/health" -Headers $headers -TimeoutSec 2).status -eq 'UP' } catch {}
if (-not $healthy) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port đã được dùng bởi process khác. Không tự dừng process." }
    $binary = Join-Path $work "reader-home-api-$Port.exe"
    Push-Location (Join-Path $root 'go-api')
    try { go build -o $binary ./cmd/local; if ($LASTEXITCODE -ne 0) { throw 'Build Go API thất bại.' } } finally { Pop-Location }
    $api = Start-Process -FilePath $binary -WorkingDirectory (Join-Path $root 'go-api') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work 'api.stdout.log') -RedirectStandardError (Join-Path $work 'api.stderr.log')
    $api.Id | Set-Content -LiteralPath (Join-Path $work 'api.pid')
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try { $healthy = (Invoke-RestMethod -Uri "$localApiUrl/api/health" -Headers $headers -TimeoutSec 2).status -eq 'UP'; if ($healthy) { break } } catch {}
        if ($api.HasExited) { throw 'API không khởi động được. Xem .reader-deploy/api.stderr.log.' }
    }
    if (-not $healthy) { throw 'API chưa sẵn sàng. Xem .reader-deploy/api.stderr.log.' }
}
$tunnelUrl = $null
if (Test-Path -LiteralPath $statePath) {
    $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $process = Get-Process -Id $previous.tunnelPid -ErrorAction SilentlyContinue
    if ($previous.port -eq $Port -and $process -and $process.ProcessName -eq 'cloudflared') {
        try { if ((Invoke-RestMethod -Uri "$($previous.tunnelUrl)/api/health" -Headers $headers -TimeoutSec 10).status -eq 'UP') { $tunnelUrl = $previous.tunnelUrl } } catch {}
    }
}
if (-not $tunnelUrl) {
    $log = Join-Path $work "tunnel-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()).log"
    $cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
    $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--protocol', 'http2', '--url', $localApiUrl) -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput "$log.stdout"
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path -LiteralPath $log) {
            $content = Get-Content -LiteralPath $log -Raw
            if ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $tunnelUrl = $Matches[0]; break }
        }
        if ($tunnel.HasExited) { throw "Tunnel không khởi động được. Xem $log" }
    }
    if (-not $tunnelUrl) { throw "Không nhận được URL tunnel. Xem $log" }
    @{ tunnelUrl = $tunnelUrl; tunnelPid = $tunnel.Id; port = $Port } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}
Write-Host "API tunnel: $tunnelUrl (được bảo vệ bằng token)"
Write-Host "Tài khoản web nằm trong: $(Join-Path $work 'login.txt')"
if ($Publish) {
    $variables = @{ NEXT_PUBLIC_API_BASE_URL = '/api'; API_INTERNAL_URL = "$tunnelUrl/api"; API_ACCESS_TOKEN = $credentials.apiToken; READER_WEB_PASSWORD = $credentials.password }
    foreach ($name in @('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value) { $variables[$name] = $value }
    }
    Push-Location (Join-Path $root 'web')
    try {
        foreach ($name in $variables.Keys) {
            # Write stdin without PowerShell's trailing newline; never put secrets in argv.
            $info = [Diagnostics.ProcessStartInfo]::new()
            $info.FileName = (Get-Command node).Source
            $cli = Join-Path (Split-Path (Get-Command vercel).Source) 'node_modules/vercel/dist/index.js'
            foreach ($argument in @($cli, 'env', 'add', $name, 'production', '--force', '--yes')) { $info.ArgumentList.Add($argument) }
            if ($name -in @('API_ACCESS_TOKEN', 'READER_WEB_PASSWORD')) { $info.ArgumentList.Add('--sensitive') }
            $info.UseShellExecute = $false
            $info.CreateNoWindow = $true
            $info.RedirectStandardInput = $true
            $info.WorkingDirectory = Join-Path $root 'web'
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
