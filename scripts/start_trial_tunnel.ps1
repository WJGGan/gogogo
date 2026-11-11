param(
    [string]$AllowedMail
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $projectRoot 'tools/cloudflared.exe'
$healthUrl = 'http://127.0.0.1:3001/api/data/health'
$serverProcess = $null

if (-not (Test-Path -LiteralPath $cloudflared -PathType Leaf)) {
    throw "Missing cloudflared: $cloudflared"
}

try {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
        if ($response.StatusCode -ne 200) { throw 'Health check failed' }
    } catch {
        $node = (Get-Command node -ErrorAction Stop).Source
        $serverProcess = Start-Process -FilePath $node -ArgumentList 'src/server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            Start-Sleep -Milliseconds 500
            try {
                $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
        }
        if (-not $ready) { throw 'Node server did not start. Check .env and dependencies.' }
    }

    if ($AllowedMail) {
        Write-Host "Local server is ready. Creating a tunnel restricted to $AllowedMail..."
        & $cloudflared tunnel --url 'http://127.0.0.1:3001' --allowed-mail $AllowedMail
    } else {
        Write-Host 'Local server is ready. Creating a public quick tunnel...'
        & $cloudflared tunnel --url 'http://127.0.0.1:3001'
    }
} finally {
    if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id
    }
}
