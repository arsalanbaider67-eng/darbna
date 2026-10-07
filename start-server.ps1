# Darbna - run the API server on this Windows PC for testing.
# Installs Bun and PostgreSQL 16 if missing, creates the database, loads the seed gazetteer and
# SAMPLE reports, then starts the server on port 8080 and checks that it answers.
#
# DEVELOPMENT ONLY: map tiles, routing and search come from free public OpenStreetMap services
# (OpenFreeMap, FOSSGIS Valhalla, nominatim.openstreetmap.org). Their usage policies allow light
# personal testing, not a public app. For launch, self-host them (docs/DEPLOYMENT.md).

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Server = Join-Path $Root "server"
$Status = Join-Path $Root "server-status.txt"
$Log = Join-Path $Root "server.log"
Set-Content $Log "Darbna server setup $(Get-Date -Format s)"

function Say($s) { Write-Host $s; Add-Content $Log $s }
function Step($msg) { $line = "$(Get-Date -Format HH:mm:ss) $msg"; Write-Host "`n=== $line" -ForegroundColor Cyan; Add-Content $Log "`n=== $line"; Set-Content $Status $line }
function Fail($msg) { Set-Content $Status "FAILED: $msg"; Add-Content $Log "FAILED: $msg"; Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.bun\bin" }
function Run($exe, [string[]]$argv) {
  $ErrorActionPreference = "Continue"
  & $exe @argv 2>&1 | ForEach-Object { Say "$_" }
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($argv -join ' ') exited with $LASTEXITCODE" }
}

try {
  # ------------------------------------------------------------------ Bun
  Step "Checking Bun"
  RefreshPath
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Step "Installing Bun (winget)"
    winget install --id Oven-sh.Bun -e --silent --accept-package-agreements --accept-source-agreements
    RefreshPath
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Fail "Bun install did not complete" }
  }
  Say "bun $(bun --version)"

  # ------------------------------------------------------------------ local config (secrets stay on this PC)
  $envFile = Join-Path $Server ".env.local"
  if (-not (Test-Path $envFile)) {
    Step "Creating server\.env.local"
    $chars = [char[]]"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $rand = { param($n) -join (1..$n | ForEach-Object { $chars | Get-Random }) }
    $pgPass = & $rand 24
    @"
# Created by start-server.ps1 for local testing. Not for production.
PORT=8080
DATABASE_URL=postgres://postgres:$pgPass@127.0.0.1:5432/darbna
PG_SUPERPASSWORD=$pgPass
INSTALL_HASH_SECRET=$(& $rand 48)
ADMIN_TOKEN=$(& $rand 40)
SAMPLE_DATA=on
ROUTING_PROVIDER=valhalla
ROUTING_URL=https://valhalla1.openstreetmap.de
ROUTING_TIMEOUT_MS=15000
GEOCODER_URL=https://nominatim.openstreetmap.org
GEOCODER_USER_AGENT=Darbna-dev/0.1 (personal testing)
GEOCODER_MIN_INTERVAL_MS=1100
GEOCODER_TIMEOUT_MS=6000
MAP_STYLE_DAY_URL=https://tiles.openfreemap.org/styles/liberty
MAP_STYLE_NIGHT_URL=https://tiles.openfreemap.org/styles/liberty
MAP_ATTRIBUTION=OpenFreeMap, OpenMapTiles, OpenStreetMap contributors
"@ | Set-Content $envFile -Encoding ascii
  }
  $cfg = @{}
  Get-Content $envFile | Where-Object { $_ -match "^\s*([A-Z_]+)=(.*)$" } | ForEach-Object { $cfg[$Matches[1]] = $Matches[2] }

  # ------------------------------------------------------------------ PostgreSQL
  Step "Checking PostgreSQL"
  $pgBin = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace "\D", "") } -Descending | Select-Object -First 1 |
    ForEach-Object { Join-Path $_.FullName "bin" }
  if (-not $pgBin) {
    Step "Installing PostgreSQL 16 (winget; Windows will ask for permission)"
    winget install --id PostgreSQL.PostgreSQL.16 -e --silent --accept-package-agreements --accept-source-agreements `
      --override "--mode unattended --unattendedmodeui none --superpassword $($cfg.PG_SUPERPASSWORD) --serverport 5432 --disable-components stackbuilder"
    $pgBin = "C:\Program Files\PostgreSQL\16\bin"
    if (-not (Test-Path (Join-Path $pgBin "psql.exe"))) { Fail "PostgreSQL install did not complete" }
  } else {
    Say "Using existing PostgreSQL at $pgBin"
  }
  $psql = Join-Path $pgBin "psql.exe"
  $env:PGPASSWORD = $cfg.PG_SUPERPASSWORD
  & $psql -h 127.0.0.1 -U postgres -tAc "SELECT 1" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Fail "Can't log in to PostgreSQL as 'postgres' with the password in server\.env.local. If PostgreSQL was already installed before, put its password in DATABASE_URL and PG_SUPERPASSWORD there and run again."
  }
  $exists = & $psql -h 127.0.0.1 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='darbna'"
  if ("$exists".Trim() -ne "1") { Run $psql @("-h", "127.0.0.1", "-U", "postgres", "-c", "CREATE DATABASE darbna") }

  # ------------------------------------------------------------------ schema + seed data
  Set-Location $Server
  Step "Migrating database"
  Run bun @("src/migrate.ts")
  Step "Loading seed gazetteer and SAMPLE reports"
  Run bun @("src/seed.ts", "gazetteer")
  Run bun @("src/seed.ts", "demo")

  # ------------------------------------------------------------------ firewall (lets the emulator/phone reach port 8080)
  if (-not (Get-NetFirewallRule -DisplayName "Darbna dev server" -ErrorAction SilentlyContinue)) {
    Step "Allowing port 8080 through Windows Firewall (Windows will ask for permission)"
    try {
      Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command "New-NetFirewallRule -DisplayName ''Darbna dev server'' -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private,Domain -Action Allow"'
    } catch { Say "Firewall rule not added: $($_.Exception.Message)" }
  }

  # ------------------------------------------------------------------ start + self-check
  Step "Starting server on port 8080"
  # Stop an earlier Darbna server still holding the port (re-running this script restarts it).
  Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq "bun") { Say "Stopping previous server (pid $($p.Id))"; Stop-Process -Id $p.Id -Force; Start-Sleep 1 }
  }
  $out = Join-Path $Root "server-output.log"
  $err = Join-Path $Root "server-error.log"
  $proc = Start-Process bun -ArgumentList "src/main.ts" -WorkingDirectory $Server -NoNewWindow -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  $ok = $false
  foreach ($i in 1..30) {
    Start-Sleep 1
    try { if ((Invoke-RestMethod "http://127.0.0.1:8080/healthz" -TimeoutSec 3).ok) { $ok = $true; break } } catch {}
    if ($proc.HasExited) { break }
  }
  if (-not $ok) { Fail "Server didn't start - see server-error.log" }

  $checks = @()
  try { $c = Invoke-RestMethod "http://127.0.0.1:8080/v1/config"; $checks += "config ok (style $($c.map.styleDay))" } catch { $checks += "config FAILED: $($_.Exception.Message)" }
  try {
    $q = [uri]::EscapeDataString("الكرادة")
    $s = Invoke-RestMethod "http://127.0.0.1:8080/v1/search?q=$q&lang=ar"
    $checks += "search ok ($($s.results.Count) results, partial=$($s.partial))"
  } catch { $checks += "search FAILED: $($_.Exception.Message)" }
  try {
    $body = '{"origin":[44.4140,33.3337],"destination":[44.2346,33.2625]}'
    $r = Invoke-RestMethod "http://127.0.0.1:8080/v1/route" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30
    $rt = $r.routes[0]
    $checks += "route ok (Tahrir Sq -> Baghdad Airport: $([math]::Round($rt.distanceM/1000,1)) km, $([math]::Round($rt.durationS/60)) min, $($rt.steps.Count) steps, $($r.routes.Count) route(s))"
  } catch { $checks += "route FAILED: $($_.Exception.Message)" }
  try {
    $tiles = Invoke-WebRequest "https://tiles.openfreemap.org/styles/liberty" -UseBasicParsing -TimeoutSec 10
    $checks += "map style reachable ($($tiles.StatusCode))"
  } catch { $checks += "map style FAILED: $($_.Exception.Message)" }
  try {
    $st = Invoke-RestMethod "http://127.0.0.1:8080/v1/style/day" -TimeoutSec 20
    $ext = @($st.layers | Where-Object { $_.type -eq "fill-extrusion" }).Count
    $checks += "light map style ok ($($st.layers.Count) layers, $ext 3D layers)"
  } catch { $checks += "light map style FAILED: $($_.Exception.Message)" }
  $checks | ForEach-Object { Say $_ }

  $ip = (Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1).IPv4Address.IPAddress
  Set-Content $Status ("RUNNING on http://${ip}:8080`n" + ($checks -join "`n"))
  Say "`nServer running at http://${ip}:8080 - keep this window open. Close it to stop the server."
  Wait-Process -Id $proc.Id
  Set-Content $Status "STOPPED"
} catch {
  Fail $_.Exception.Message
}
