# stagemix-common.ps1
# Shared helpers for the Stage Mix command-line launcher and tray indicator.
# Dot-sourced by stagemix.ps1 and stagemix-tray.ps1. Targets Windows PowerShell 5.1.

$ErrorActionPreference = 'Stop'

# Project root is the parent of the scripts folder.
$Script:Root = Split-Path -Parent $PSScriptRoot
$Script:Port = 3000
if ($env:STAGEMIX_PORT -and $env:STAGEMIX_PORT -match '^\d+$') {
  $Script:Port = [int]$env:STAGEMIX_PORT
}
$Script:Url = "http://localhost:$Script:Port"

$Script:PidFile     = Join-Path $Script:Root 'logs\stagemix.pid'
$Script:TrayPidFile = Join-Path $Script:Root 'logs\stagemix-tray.pid'
$Script:OutLog      = Join-Path $Script:Root 'logs\stagemix-out.log'
$Script:ErrLog      = Join-Path $Script:Root 'logs\stagemix-err.log'
$Script:TrayScript  = Join-Path $PSScriptRoot 'stagemix-tray.ps1'

function Write-Msg {
  param([string]$Text, [string]$Color = 'Gray')
  Write-Host $Text -ForegroundColor $Color
}

# A "node" process matching a given PID (if alive), else $null.
function Get-NodeProcessById {
  param([int]$Id)
  if (-not $Id) { return $null }
  try {
    $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') { return $p }
  } catch { }
  return $null
}

# Resolve the PID of the running server, using (in order):
#   1. the PID file (authoritative - written by stagemix start)
#   2. any "node" process listening on the app port
# Returns the PID (int) or $null.
function Get-StagemixPid {
  # 1. PID file
  if (Test-Path $Script:PidFile) {
    try {
      $id = [int](Get-Content $Script:PidFile -Raw).Trim()
      if (Get-NodeProcessById $id) { return $id }
    } catch { }
  }
  # 2. port listener
  try {
    $conns = Get-NetTCPConnection -LocalPort $Script:Port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
      foreach ($c in $conns) {
        if (Get-NodeProcessById $c.OwningProcess) { return $c.OwningProcess }
      }
    }
  } catch { }
  return $null
}

# Is the app actually answering HTTP? (authoritative "is it serving" check)
function Test-StagemixResponding {
  try {
    $r = Invoke-WebRequest -Uri "$Script:Url/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# Is the app running? PID-based check first (fast), HTTP check as fallback so a
# server started without the PID file (e.g. an old console window) is detected.
function Test-StagemixRunning {
  $procId = Get-StagemixPid
  if ($procId) { return $true }
  return (Test-StagemixResponding)
}

function Remove-PidFile {
  Remove-Item -Path $Script:PidFile -Force -ErrorAction SilentlyContinue
}

function Get-TrayPid {
  if (Test-Path $Script:TrayPidFile) {
    try {
      $id = [int](Get-Content $Script:TrayPidFile -Raw).Trim()
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p -and ($p.ProcessName -eq 'powershell' -or $p.ProcessName -eq 'pwsh')) { return $id }
    } catch { }
  }
  return $null
}

function Test-TrayRunning {
  return ($null -ne (Get-TrayPid))
}

# Launch the tray indicator as its own hidden process (returns immediately).
function Start-Tray {
  if (Test-TrayRunning) { return $null }
  # Quoting note: the scripts path contains spaces, so the -File argument must
  # be wrapped in embedded double quotes when passed as a single argument line.
  $argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script:TrayScript`""
  $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -WindowStyle Hidden -PassThru
  $proc.Id | Set-Content -Path $Script:TrayPidFile -Encoding ASCII
  return $proc
}

# Stop the tray indicator if it is running.
function Stop-Tray {
  $id = Get-TrayPid
  if ($id) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -Path $Script:TrayPidFile -Force -ErrorAction SilentlyContinue
}
