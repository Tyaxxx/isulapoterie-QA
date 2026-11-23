# Exports business-card/card.html into business-card/export/:
#   card-front.png   85 x 55 mm at ~760 dpi (2550 x 1650 px), no bleed
#   card-back.png    same, back side
# Needs a Chromium browser (Edge, Chrome or Brave).

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out  = Join-Path $here 'export'
New-Item -ItemType Directory -Force $out | Out-Null

# ---- Find a Chromium browser ----
$browser = $null
foreach ($exe in 'msedge.exe', 'chrome.exe', 'brave.exe') {
  foreach ($root in 'HKLM:', 'HKCU:') {
    $key = "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe"
    if (-not $browser -and (Test-Path $key)) {
      $path = (Get-ItemProperty $key).'(default)'
      if ($path -and (Test-Path $path)) { $browser = $path }
    }
  }
}
if (-not $browser) { Write-Host 'Error: no Edge, Chrome or Brave found.'; exit 1 }

$url     = ([Uri](Join-Path $here 'card.html')).AbsoluteUri
$profileDir = Join-Path $env:TEMP 'isula-card-export'   # separate profile: works even if the browser is open
$common  = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
             "--user-data-dir=$profileDir")

function Invoke-Browser([string[]] $arguments) {
  # Called directly (not Start-Process) so PowerShell waits for the export and passes paths intact
  $ErrorActionPreference = 'Continue'   # the browser logs harmless messages on stderr
  $all = $common + $arguments
  & $browser @all 2>$null | Out-Null
}

Remove-Item (Join-Path $out '*') -Force -ErrorAction SilentlyContinue

# The browser's visible area can be a few pixels smaller than the window, which leaves a
# blank strip at the edge. So: capture a larger window, then crop exactly the card.
# Whole-number scale only (a fractional one also leaves blank lines).
Add-Type -AssemblyName System.Drawing
$scale = 3
$cardW = 850 * $scale; $cardH = 550 * $scale
foreach ($side in 'front', 'back') {
  $raw = Join-Path $out "raw-$side.png"
  Invoke-Browser @("--screenshot=$raw", '--window-size=1000,700', "--force-device-scale-factor=$scale", "$url`?side=$side")
  $src = [Drawing.Bitmap]::FromFile($raw)
  $dst = $src.Clone((New-Object Drawing.Rectangle 0, 0, $cardW, $cardH), $src.PixelFormat)
  $dst.Save((Join-Path $out "card-$side.png"), [Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose(); $src.Dispose()
  Remove-Item $raw
}

foreach ($f in 'card-front.png', 'card-back.png') {
  $p = Join-Path $out $f
  if (Test-Path $p) { Write-Host ("OK      export\$f  ({0:N0} KB)" -f ((Get-Item $p).Length / 1KB)) }
  else { Write-Host "Missing export\$f" }
}
