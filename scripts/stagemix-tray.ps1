# stagemix-tray.ps1
# Stage Mix system-tray indicator. Runs hidden in the background and shows a
# green dot while the app is serving, red when it is stopped. Right-click for a
# menu (Open web UI / Start / Stop / Restart / Exit).
# Launched by stagemix.ps1 (Start-Tray). Targets Windows PowerShell 5.1.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'stagemix-common.ps1')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---- draw a simple colored circle icon at runtime (no .ico asset needed) ----
function New-StatusIcon {
  param([System.Drawing.Color]$Color)
  $size = 32
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $brush = New-Object System.Drawing.SolidBrush($Color)
  $g.FillEllipse($brush, 3, 3, $size - 6, $size - 6)
  $brush.Dispose()
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $bmp.Dispose()
  return $icon
}

$iconRunning = New-StatusIcon ([System.Drawing.Color]::FromArgb(255, 46, 204, 113))   # green
$iconStopped = New-StatusIcon ([System.Drawing.Color]::FromArgb(255, 224, 96, 79))    # red

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Visible = $true
$tray.Text = 'Stage Mix'
$tray.Icon = $iconStopped

$menu = New-Object System.Windows.Forms.ContextMenuStrip

function Add-MenuItem {
  param([string]$Text, [scriptblock]$OnClick)
  $item = New-Object System.Windows.Forms.ToolStripMenuItem
  $item.Text = $Text
  if ($OnClick) { $item.Add_Click($OnClick) }
  $menu.Items.Add($item) | Out-Null
  return $item
}

Add-MenuItem 'Open web UI' { Start-Process $Script:Url }
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

Add-MenuItem 'Start'   { & (Join-Path $Script:Root 'stagemix.cmd') start }
Add-MenuItem 'Stop'    { & (Join-Path $Script:Root 'stagemix.cmd') stop }
Add-MenuItem 'Restart' { & (Join-Path $Script:Root 'stagemix.cmd') restart }

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
Add-MenuItem 'Exit' {
  $tray.Visible = $false
  $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
}

$tray.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ Start-Process $Script:Url })

# ---- poll the app health every 3 seconds and flip the icon color ----
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000

$updateState = {
  $running = Test-StagemixRunning
  if ($running) {
    if ($tray.Icon -ne $iconRunning) { $tray.Icon = $iconRunning }
    $tray.Text = "Stage Mix - running on $Script:Url"
  } else {
    if ($tray.Icon -ne $iconStopped) { $tray.Icon = $iconStopped }
    $tray.Text = 'Stage Mix - stopped'
  }
}

$timer.Add_Tick($updateState)
& $updateState
$timer.Start()

# Keep the message loop alive (blocking).
[System.Windows.Forms.Application]::Run()

# Cleanup on exit.
$timer.Stop()
$timer.Dispose()
$tray.Visible = $false
$tray.Dispose()
