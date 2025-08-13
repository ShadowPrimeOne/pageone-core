param(
  [int]$Port = 3000
)

Write-Host "=== PageOne Dev Start ===" -ForegroundColor Cyan

function Stop-PortProcess {
  param([int]$Port)
  try {
    $procId = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)
  } catch { $procId = $null }

  if (-not $procId) {
    try {
      $net = netstat -ano | findstr ":$Port" | findstr LISTENING
      if ($net) {
        $parts = $net.Trim() -split "\s+"
        $procId = $parts[-1]
      }
    } catch { $procId = $null }
  }

  if ($procId) {
    try {
      Write-Host "Stopping process on port $Port (PID $procId)" -ForegroundColor Yellow
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Host "Failed to stop PID $($procId): $($_.Exception.Message)" -ForegroundColor Red
    }
  } else {
    Write-Host "No process listening on port $Port" -ForegroundColor DarkGray
  }
}

# Resolve Chrome path and open URL helpers
function Get-ChromePath {
  $candidates = @(
    "$Env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
    "${Env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",
    "$Env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe"
  )
  foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
  return $null
}

function Open-Chrome([string]$url) {
  $chrome = Get-ChromePath
  if ($chrome) {
    Write-Host "Opening Chrome: $url" -ForegroundColor Cyan
    Start-Process -FilePath $chrome -ArgumentList @("--new-window", $url) | Out-Null
  } else {
    Write-Host "Chrome not found, opening default browser: $url" -ForegroundColor Yellow
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c start $url" | Out-Null
  }
}

function Get-StripePath {
  if ($env:STRIPE_CLI_PATH -and (Test-Path $env:STRIPE_CLI_PATH)) { return $env:STRIPE_CLI_PATH }
  try {
    $cmd = Get-Command stripe -ErrorAction Stop
    if ($cmd -and $cmd.Path) { return $cmd.Path }
  } catch {}
  $candidates = @(
    "$Env:ProgramFiles\\Stripe\\Stripe CLI\\bin\\stripe.exe",
    "$Env:LOCALAPPDATA\\Programs\\stripe\\stripe.exe",
    "$Env:USERPROFILE\\scoop\\shims\\stripe.exe",
    "$Env:ChocolateyInstall\\bin\\stripe.exe"
  )
  foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

function Wait-And-OpenBrowser([int]$port) {
  $url = "http://localhost:$port"
  for ($i = 0; $i -lt 90; $i++) { # up to ~90s
    try {
      $tcp = Test-NetConnection -ComputerName "localhost" -Port $port -WarningAction SilentlyContinue
      if ($tcp -and $tcp.TcpTestSucceeded) { Open-Chrome $url; return }
    } catch { }
    Start-Sleep -Seconds 1
  }
  # Fallback: try http request then open anyway
  try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { }
  Open-Chrome $url
}

# Kill any ghost processes
Stop-PortProcess -Port $Port

# Clear Next.js cache
if (Test-Path ".next") {
  Write-Host "Removing .next cache" -ForegroundColor Yellow
  Remove-Item -Recurse -Force ".next" -ErrorAction SilentlyContinue
}

# Clear environment caches if any
$env:NODE_OPTIONS = ""

# --- Scraper worker tunnel + env bootstrap ---
$ScraperKeyPath    = "$env:USERPROFILE\.ssh\pageone_ed25519"
$ScraperRemoteUser = "shadow_prime_one"
$ScraperRemoteHost = "34.9.45.190"
$ScraperLocalPort  = 8878
$ScraperRemotePort = 8787

# Export env vars so the spawned Next.js dev inherits them
$env:SCRAPER_WORKER_URL = "http://127.0.0.1:$ScraperLocalPort"
$env:WORKER_TIMEOUT_MS  = "10000"

try {
  $listener = Get-NetTCPConnection -LocalPort $ScraperLocalPort -State Listen -ErrorAction SilentlyContinue
} catch { $listener = $null }

if (-not $listener) {
  if (Test-Path $ScraperKeyPath) {
    Write-Host "Ensuring SSH tunnel $($ScraperLocalPort) -> $($ScraperRemoteHost):$($ScraperRemotePort)" -ForegroundColor Cyan
    $sshArgs = "-i `"$ScraperKeyPath`" -N -L $($ScraperLocalPort):127.0.0.1:$($ScraperRemotePort) $ScraperRemoteUser@$ScraperRemoteHost"
    Start-Process -FilePath "ssh" -ArgumentList $sshArgs -WindowStyle Hidden | Out-Null

    # Wait until healthy (max ~10s)
    $healthy = $false
    for ($i=0; $i -lt 10; $i++) {
      Start-Sleep -Seconds 1
      try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$ScraperLocalPort/health"
        if ($r.Content -match '"ok":true') { $healthy = $true; break }
      } catch { }
    }
    if (-not $healthy) {
      Write-Host "Warning: Scraper tunnel did not become healthy on 127.0.0.1:$ScraperLocalPort" -ForegroundColor Yellow
    } else {
      Write-Host "Scraper tunnel is ready on http://127.0.0.1:$ScraperLocalPort" -ForegroundColor Green
    }
  } else {
    Write-Host "SSH key not found at $ScraperKeyPath; skipping tunnel. Set SCRAPER_WORKER_URL manually if needed." -ForegroundColor Yellow
  }
} else {
  Write-Host "SSH tunnel already listening on 127.0.0.1:$ScraperLocalPort" -ForegroundColor Green
}
# --- end tunnel + env bootstrap ---

Write-Host "Starting Next.js dev server on http://localhost:$Port" -ForegroundColor Green
# Launch background job to wait for server then open Chrome
Start-Job -ScriptBlock {
  param($p)
  Import-Module Microsoft.PowerShell.Management -ErrorAction SilentlyContinue | Out-Null
  Import-Module Microsoft.PowerShell.Utility -ErrorAction SilentlyContinue | Out-Null
  function Get-ChromePath {
    $candidates = @(
      "$Env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",
      "${Env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",
      "$Env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe"
    )
    foreach ($cp in $candidates) { if (Test-Path $cp) { return $cp } }
    return $null
  }
  function Open-Chrome([string]$u) {
    $chrome = Get-ChromePath
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList @("--new-window", $u) | Out-Null }
    else { Start-Process -FilePath "cmd.exe" -ArgumentList "/c start $u" | Out-Null }
  }
  $url = "http://localhost:$p"
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $tcp = Test-NetConnection -ComputerName "localhost" -Port $p -WarningAction SilentlyContinue
      if ($tcp -and $tcp.TcpTestSucceeded) { Open-Chrome $url; return }
    } catch { }
    Start-Sleep -Seconds 1
  }
  Open-Chrome $url
} -ArgumentList $Port | Out-Null

$env:PORT = $Port

# Start Stripe CLI listener (optional but recommended for local dev)
try {
  $stripePath = Get-StripePath
  if ($stripePath) {
    # If webhook secret not set, fetch one for this session
    if (-not $env:STRIPE_WEBHOOK_SECRET -or [string]::IsNullOrWhiteSpace($env:STRIPE_WEBHOOK_SECRET)) {
      Write-Host "Fetching STRIPE_WEBHOOK_SECRET via 'stripe listen --print-secret'..." -ForegroundColor Cyan
      try {
        $secret = (& $stripePath listen --print-secret) 2>$null
        if ($LASTEXITCODE -eq 0 -and $secret -and ($secret.Trim()) -match '^whsec_') {
          $env:STRIPE_WEBHOOK_SECRET = $secret.Trim()
          Write-Host "STRIPE_WEBHOOK_SECRET set for this session." -ForegroundColor Green
        } else {
          Write-Host "Could not retrieve webhook secret automatically. If this is your first run, you may need to run 'stripe login' once." -ForegroundColor Yellow
        }
      } catch {
        Write-Host "stripe listen --print-secret failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "If this is the first time using Stripe CLI, run 'stripe login' in a terminal to authenticate." -ForegroundColor Yellow
      }
    }

    Write-Host "Starting Stripe CLI listener -> http://localhost:$Port/api/stripe/webhook" -ForegroundColor Green
    # Do not hide the window so first-time login prompts are visible
    Start-Process -FilePath $stripePath -ArgumentList @("listen","--forward-to","http://localhost:$Port/api/stripe/webhook") | Out-Null
  } else {
    Write-Host "Stripe CLI not found. Install from https://stripe.com/cli (or via winget/scoop) to enable local webhooks." -ForegroundColor Yellow
  }
} catch {
  Write-Host "Could not start Stripe CLI listener: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Launch Next.js in a separate window to avoid blocking the current terminal/agent
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit","-Command","npm run dev") -WorkingDirectory $PWD.Path | Out-Null
Write-Host "Next.js dev server launched in a new window. This script will now exit to avoid blocking." -ForegroundColor Cyan
exit 0
