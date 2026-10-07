# Darbna - build a release APK on Windows.
# Installs what's missing (Node.js LTS, JDK 17, Android SDK command-line tools), then runs
# npm install -> expo prebuild -> gradle assembleRelease. Re-running is safe and skips finished steps.
# Output: Darbna.apk next to this script. Full log: build.log. Current step: build-status.txt.
# Note: the release APK is signed with the Android debug key - fine for testing, not for the Play Store.
param(
  # API the app talks to. Default: this PC's LAN address on port 8080 (run the server here).
  [string]$ApiUrl = ""
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Status = Join-Path $Root "build-status.txt"
$Log = Join-Path $Root "build.log"
Set-Content $Log "Darbna Android build $(Get-Date -Format s)"

function Say($s) { Write-Host $s; Add-Content $Log $s }
function Step($msg) { $line = "$(Get-Date -Format HH:mm:ss) $msg"; Write-Host "`n=== $line" -ForegroundColor Cyan; Add-Content $Log "`n=== $line"; Set-Content $Status $line }
function Fail($msg) { Set-Content $Status "FAILED: $msg"; Add-Content $Log "FAILED: $msg"; Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
# Runs a native command, mirroring stdout+stderr to the console and build.log.
function Run($exe, [string[]]$argv) {
  $ErrorActionPreference = "Continue"
  & $exe @argv 2>&1 | ForEach-Object { Say "$_" }
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($argv -join ' ') exited with $LASTEXITCODE" }
}

try {
  # ------------------------------------------------------------------ Node.js
  Step "Checking Node.js"
  RefreshPath
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Step "Installing Node.js LTS (winget; Windows may ask for permission)"
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    RefreshPath
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js install did not complete" }
  }
  $nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
  if ($nodeMajor -lt 20) { Fail "Node $((node -v)) is too old; Expo SDK 54 needs Node 20+. Update Node and re-run." }
  Say "node $(node -v), npm $(npm -v)"

  # ------------------------------------------------------------------ JDK 17
  Step "Checking JDK 17"
  $jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $jdk) {
    Step "Installing Temurin JDK 17 (winget; Windows may ask for permission)"
    winget install --id EclipseAdoptium.Temurin.17.JDK -e --silent --accept-package-agreements --accept-source-agreements
    $jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $jdk) { Fail "JDK 17 install did not complete" }
  }
  $env:JAVA_HOME = $jdk.FullName
  $env:Path = "$($env:JAVA_HOME)\bin;$env:Path"
  Say "JAVA_HOME=$env:JAVA_HOME"

  # ------------------------------------------------------------------ Android SDK
  Step "Checking Android SDK"
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
  $sdkmanager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"
  if (-not (Test-Path $sdkmanager)) {
    Step "Downloading Android command-line tools from dl.google.com"
    New-Item -ItemType Directory -Force -Path (Join-Path $sdk "cmdline-tools") | Out-Null
    $zip = Join-Path $env:TEMP "android-cmdline-tools.zip"
    $ok = $false
    foreach ($v in @("13114758", "12266719", "11076708")) {
      try {
        Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-${v}_latest.zip" -OutFile $zip -UseBasicParsing
        $ok = $true; break
      } catch { Write-Host "cmdline-tools $v not available, trying older" }
    }
    if (-not $ok) { Fail "Could not download Android command-line tools" }
    $tmp = Join-Path $env:TEMP "android-cmdline-tools"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip $tmp -Force
    Move-Item (Join-Path $tmp "cmdline-tools") (Join-Path $sdk "cmdline-tools\latest") -Force
  }
  $env:ANDROID_HOME = $sdk
  $env:ANDROID_SDK_ROOT = $sdk
  [Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdk, "User")

  Step "Accepting Android SDK licenses and installing platform 36, build-tools, NDK (several GB, first time only)"
  $yes = ("y`n" * 50)
  $ErrorActionPreference = "Continue"
  $yes | & $sdkmanager --licenses 2>&1 | Out-Null
  $ErrorActionPreference = "Stop"
  Run $sdkmanager @("platform-tools", "platforms;android-36", "build-tools;36.0.0", "ndk;27.1.12297006")

  # ------------------------------------------------------------------ JS dependencies
  Step "npm install (workspaces)"
  Set-Location $Root
  Run npm @("install", "--no-audit", "--no-fund")

  $Mobile = Join-Path $Root "apps\mobile"
  Set-Location $Mobile
  Step "Aligning native module versions with Expo SDK (expo install --fix)"
  Run npx @("expo", "install", "--fix")

  # ------------------------------------------------------------------ API URL baked into the app
  if (-not $ApiUrl) {
    # The adapter with a default gateway is the real LAN (skips VirtualBox/VPN adapters).
    $ip = (Get-NetIPConfiguration -ErrorAction SilentlyContinue |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
      Select-Object -First 1).IPv4Address.IPAddress
    $ApiUrl = if ($ip) { "http://${ip}:8080" } else { "http://10.0.2.2:8080" }
  }
  $env:EXPO_PUBLIC_API_URL = $ApiUrl
  Say "EXPO_PUBLIC_API_URL=$ApiUrl"

  # ------------------------------------------------------------------ native project + build
  $env:CI = "1"
  # Bundle relative to apps/mobile, not the monorepo root (Metro otherwise can't find index.ts on release export).
  $env:EXPO_NO_METRO_WORKSPACE_ROOT = "1"
  if (-not (Test-Path (Join-Path $Mobile "android\gradlew.bat")) -or $env:DARBNA_CLEAN -eq "1") {
    Step "Generating the Android project (expo prebuild)"
    Run npx @("expo", "prebuild", "--platform", "android", "--clean")
  } else {
    Step "Android project already generated (set DARBNA_CLEAN=1 to regenerate)"
  }

  Step "Compiling release APK with Gradle (first run downloads Gradle + dependencies, 10-30 min)"
  Set-Location (Join-Path $Mobile "android")
  $env:NODE_ENV = "production"
  Run ".\gradlew.bat" @("assembleRelease", "--no-daemon", "--console=plain")

  $apk = Join-Path $Mobile "android\app\build\outputs\apk\release\app-release.apk"
  if (-not (Test-Path $apk)) { Fail "Gradle finished but no APK at $apk" }
  Copy-Item $apk (Join-Path $Root "Darbna.apk") -Force
  $mb = [math]::Round((Get-Item $apk).Length / 1MB, 1)
  Set-Content $Status "DONE: Darbna.apk ($mb MB), API $ApiUrl"
  Say "`nDONE: $Root\Darbna.apk ($mb MB)"
} catch {
  Fail $_.Exception.Message
}
