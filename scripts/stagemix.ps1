# stagemix.ps1
# Stage Mix command-line control. Invoked by stagemix.cmd as:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File stagemix.ps1 -Action <verb>
# Targets Windows PowerShell 5.1.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start','stop','restart','status','tray','install','uninstall','help')]
  [string]$Action
)

. (Join-Path $PSScriptRoot 'stagemix-common.ps1')

function Invoke-Start {
  if (Test-StagemixRunning) {
    Write-Msg "Stage Mix is already running at $Script:Url" 'Yellow'
  } else {
    # Ensure dependencies exist (first-run only; node_modules is gitignored).
    if (-not (Test-Path (Join-Path $Script:Root 'node_modules'))) {
      Write-Msg "First run - installing dependencies..." 'Yellow'
      Push-Location $Script:Root
      try { npm install --no-fund --no-audit } finally { Pop-Location }
      if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $Script:Root 'logs') | Out-Null
    Remove-PidFile

    # The server reads process.env.PORT (see server/index.js). PowerShell 5.1
    # Start-Process has no -Environment switch, so we set PORT on our own
    # process for the spawn (children inherit it) and restore it right after.
    $prevPort = $env:PORT
    $env:PORT = "$Script:Port"
    try {
      # Relative entry path (space-free) + -WorkingDirectory avoids the
      # Start-Process argument-splitting bug when the project path has spaces.
      $proc = Start-Process -FilePath 'node.exe' `
        -ArgumentList 'server\index.js' `
        -WorkingDirectory $Script:Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $Script:OutLog `
        -RedirectStandardError $Script:ErrLog `
        -PassThru
    } finally {
      $env:PORT = $prevPort
    }
    $proc.Id | Set-Content -Path $Script:PidFile -Encoding ASCII

    Write-Msg "Stage Mix started in the background (PID $($proc.Id))" 'Green'
    Write-Msg "  URL : $Script:Url" 'Green'
    Write-Msg "  Logs: $Script:OutLog" 'Gray'
  }

  if (Test-TrayRunning) {
    Write-Msg "Tray indicator is already running." 'Gray'
  } else {
    Start-Tray | Out-Null
    Write-Msg "Tray indicator started (green = running)." 'Green'
  }
}

function Invoke-Stop {
  # Stop the server.
  $pidToKill = Get-StagemixPid
  if ($pidToKill) {
    Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
    Write-Msg "Stage Mix stopped (PID $pidToKill)." 'Green'
  } else {
    Write-Msg "Stage Mix is not running." 'Yellow'
  }
  Remove-PidFile

  # Stop the tray indicator too, so nothing is left in the notification area.
  if (Test-TrayRunning) {
    Stop-Tray
    Write-Msg "Tray indicator closed." 'Gray'
  }
}

function Invoke-Restart {
  Invoke-Stop
  Start-Sleep -Milliseconds 700
  Invoke-Start
}

function Invoke-Status {
  if (Test-StagemixRunning) {
    $procId = Get-StagemixPid
    Write-Msg "Stage Mix is RUNNING at $Script:Url" 'Green'
    if ($procId) { Write-Msg "  PID: $procId" 'Green' } else { Write-Msg "  (detected via HTTP; no PID file)" 'Gray' }
  } else {
    Write-Msg "Stage Mix is STOPPED." 'Yellow'
  }
  if (Test-TrayRunning) {
    Write-Msg "Tray indicator: running." 'Gray'
  } else {
    Write-Msg "Tray indicator: not running." 'Gray'
  }
}

function Invoke-Install {
  # Add this project folder to the USER PATH so "stagemix" resolves from any shell.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $norm = $Script:Root.TrimEnd('\')
  $parts = @()
  if ($userPath) { $parts = $userPath.Split(';') | Where-Object { $_ } }
  $already = $parts | Where-Object { $_.TrimEnd('\') -eq $norm }
  if ($already) {
    Write-Msg "This folder is already on your user PATH." 'Yellow'
    Write-Msg "  $norm" 'Gray'
  } else {
    $parts += $norm
    $newPath = ($parts -join ';')
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Msg "Added to your user PATH:" 'Green'
    Write-Msg "  $norm" 'Gray'
    Write-Msg "Open a NEW terminal window, then run: stagemix start" 'Green'
  }
}

function Invoke-Uninstall {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $norm = $Script:Root.TrimEnd('\')
  if ($userPath) {
    $parts = $userPath.Split(';') | Where-Object { $_ -and $_.TrimEnd('\') -ne $norm }
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
    Write-Msg "Removed this folder from your user PATH." 'Green'
  } else {
    Write-Msg "Nothing to remove." 'Yellow'
  }
}

switch ($Action) {
  'start'     { Invoke-Start }
  'stop'      { Invoke-Stop }
  'restart'   { Invoke-Restart }
  'status'    { Invoke-Status }
  'tray'      { if (Test-TrayRunning) { Write-Msg "Tray indicator is already running." 'Yellow' } else { Start-Tray | Out-Null; Write-Msg "Tray indicator started." 'Green' } }
  'install'   { Invoke-Install }
  'uninstall' { Invoke-Uninstall }
  'help'      {
    Write-Msg "Stage Mix commands:" 'Gray'
    Write-Msg "  start | stop | restart | status | tray | install | uninstall | help" 'Gray'
  }
}
