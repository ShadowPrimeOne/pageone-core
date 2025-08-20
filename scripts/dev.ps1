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

# Helper: read a var from .env.local (basic parser: NAME=VALUE, ignores # comments)
function Get-EnvLocalVar {
  param([string]$Name)
  $envFile = Join-Path $PWD.Path ".env.local"
  if (-not (Test-Path $envFile)) { return $null }
  try {
    $lines = Get-Content -Path $envFile -ErrorAction Stop
    foreach ($line in $lines) {
      $t = $line.Trim()
      if (-not $t -or $t.StartsWith('#')) { continue }
      $eq = $t.IndexOf('=')
      if ($eq -lt 1) { continue }
      $k = $t.Substring(0, $eq).Trim()
      $v = $t.Substring($eq+1).Trim()
      if ($k -ieq $Name) { return $v }
    }
  } catch { }
  return $null
}

# Helper: quick health check for scraper worker
function Test-WorkerHealth {
  param([string]$BaseUrl, [int]$TimeoutSec = 3)
  if (-not $BaseUrl) { return $false }
  $healthUrl = "$BaseUrl/health"
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec $TimeoutSec -Uri $healthUrl
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
  } catch { }
  return $false
}

# Helper: quick health check for SearXNG
function Test-SearxHealth {
  param([string]$BaseUrl, [int]$TimeoutSec = 3)
  if (-not $BaseUrl) { return $false }
  try {
    $url = ($BaseUrl.TrimEnd('/') + '/search?q=test&format=json&limit=1&language=en-AU')
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec $TimeoutSec -Uri $url -Headers @{ 'Accept' = 'application/json' }
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
  } catch { }
  return $false
}

# --- Scraper worker URL resolution + optional tunnel ---
# Always resolve scraper URL (scraping depends on it even if GOLDEN provider is serper)
$goldenProvider = $env:GOLDEN_SEARCH_PROVIDER
if (-not $goldenProvider -or [string]::IsNullOrWhiteSpace($goldenProvider)) {
  $goldenProvider = Get-EnvLocalVar -Name "GOLDEN_SEARCH_PROVIDER"
}

$ScraperKeyPath    = "$env:USERPROFILE\.ssh\pageone_ed25519"
$ScraperRemoteUser = "shadow_prime_one"
$ScraperRemoteHost = "34.9.45.190"
$ScraperLocalPort  = 8878
$ScraperRemotePort = 8787

# Prefer public worker if reachable; else fall back to local tunnel
$publicDefault = "http://${ScraperRemoteHost}:${ScraperRemotePort}"

$resolvedUrl = $env:SCRAPER_WORKER_URL
if (-not $resolvedUrl -or [string]::IsNullOrWhiteSpace($resolvedUrl)) {
  $resolvedUrl = Get-EnvLocalVar -Name "SCRAPER_WORKER_URL"
}
if (-not $resolvedUrl -or [string]::IsNullOrWhiteSpace($resolvedUrl)) {
  $resolvedUrl = $publicDefault
  try {
    if (-not (Test-WorkerHealth -BaseUrl $resolvedUrl -TimeoutSec 2)) {
      $resolvedUrl = "http://127.0.0.1:$ScraperLocalPort"
    }
  } catch {
    $resolvedUrl = "http://127.0.0.1:$ScraperLocalPort"
  }
}

$env:SCRAPER_WORKER_URL = $resolvedUrl
$env:WORKER_TIMEOUT_MS  = "10000"

# Decide if we need an SSH tunnel (only when targeting localhost:8878)
$useTunnel = $false
try {
  $u = [Uri]$resolvedUrl
  $dnsHost = $u.DnsSafeHost.ToLowerInvariant()
  $resolvedPort = if ($u.IsDefaultPort) { if ($u.Scheme -eq 'https') { 443 } else { 80 } } else { $u.Port }
  if (($dnsHost -eq '127.0.0.1' -or $dnsHost -eq 'localhost') -and $resolvedPort -eq $ScraperLocalPort) { $useTunnel = $true }
} catch { $useTunnel = $false }

# If targeting a non-local worker and it's unhealthy, auto-fallback to local tunnel
if (-not $useTunnel) {
  try {
    if (-not (Test-WorkerHealth -BaseUrl $resolvedUrl -TimeoutSec 2)) {
      $resolvedUrl = "http://127.0.0.1:$ScraperLocalPort"
      $env:SCRAPER_WORKER_URL = $resolvedUrl
      $useTunnel = $true
      Write-Host "Public worker unreachable. Falling back to local tunnel at $resolvedUrl" -ForegroundColor Yellow
    }
  } catch {
    $resolvedUrl = "http://127.0.0.1:$ScraperLocalPort"
    $env:SCRAPER_WORKER_URL = $resolvedUrl
    $useTunnel = $true
    Write-Host "Error probing public worker. Falling back to local tunnel at $resolvedUrl" -ForegroundColor Yellow
  }
}

if ($useTunnel) {
  try { $listener = Get-NetTCPConnection -LocalPort $ScraperLocalPort -State Listen -ErrorAction SilentlyContinue } catch { $listener = $null }
  if (-not $listener) {
    if (Test-Path $ScraperKeyPath) {
      Write-Host "Ensuring SSH tunnel $($ScraperLocalPort) -> $($ScraperRemoteHost):$($ScraperRemotePort)" -ForegroundColor Cyan
      $sshArgs = "-i `"$ScraperKeyPath`" -N -L $($ScraperLocalPort):127.0.0.1:$($ScraperRemotePort) $ScraperRemoteUser@$ScraperRemoteHost"
      Start-Process -FilePath "ssh" -ArgumentList $sshArgs -WindowStyle Hidden | Out-Null
      # Wait until healthy (max ~10s)
      $healthy = $false
      for ($i=0; $i -lt 10; $i++) { Start-Sleep -Seconds 1; if (Test-WorkerHealth -BaseUrl $resolvedUrl -TimeoutSec 3) { $healthy = $true; break } }
      if (-not $healthy) { Write-Host "Warning: Scraper tunnel did not become healthy on $resolvedUrl" -ForegroundColor Yellow }
      else { Write-Host "Scraper tunnel is ready on $resolvedUrl" -ForegroundColor Green }
    } else {
      Write-Host "SSH key not found at $ScraperKeyPath; skipping tunnel. Set SCRAPER_WORKER_URL to a reachable URL (e.g., $publicDefault)." -ForegroundColor Yellow
    }
  } else {
    Write-Host "SSH tunnel already listening on 127.0.0.1:$ScraperLocalPort" -ForegroundColor Green
  }
} else {
  Write-Host "Using scraper: $resolvedUrl (no tunnel)" -ForegroundColor Green
  if (Test-WorkerHealth -BaseUrl $resolvedUrl -TimeoutSec 3) {
    Write-Host "Scraper health OK at $resolvedUrl/health" -ForegroundColor Green
  } else {
    Write-Host "Warning: Could not reach $resolvedUrl/health (will still start Next.js)." -ForegroundColor Yellow
  }
}
# --- end scraper bootstrap ---

# --- SearXNG base URL setup ---
$resolvedSearx = $env:SEARXNG_BASE_URL
if (-not $resolvedSearx -or [string]::IsNullOrWhiteSpace($resolvedSearx)) {
  $resolvedSearx = Get-EnvLocalVar -Name "SEARXNG_BASE_URL"
}
if (-not $resolvedSearx -or [string]::IsNullOrWhiteSpace($resolvedSearx)) {
  $resolvedSearx = "https://searxng.pageone.live"
}
$env:SEARXNG_BASE_URL = $resolvedSearx
if (Test-SearxHealth -BaseUrl $resolvedSearx -TimeoutSec 3) {
  Write-Host "SearXNG OK at $resolvedSearx" -ForegroundColor Green
} else {
  # Try HTTP fallback if HTTPS failed
  $httpFallback = $null
  if ($resolvedSearx -like 'https://*') {
    $httpFallback = 'http://' + $resolvedSearx.Substring(8)
  }
  if ($httpFallback -and (Test-SearxHealth -BaseUrl $httpFallback -TimeoutSec 3)) {
    $resolvedSearx = $httpFallback
    $env:SEARXNG_BASE_URL = $resolvedSearx
    Write-Host "SearXNG OK (HTTP fallback) at $resolvedSearx" -ForegroundColor Yellow
  } else {
    Write-Host "Warning: Could not reach SearXNG at $resolvedSearx (continuing)" -ForegroundColor Yellow
  }
}

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
