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
npm run dev
