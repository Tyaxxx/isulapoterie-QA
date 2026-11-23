<#
  Corrects the photos: same backdrop brightness, white balance and contrast on
  every photo, without changing the true colours of the pieces.

  Reads the originals from   photo-sources/<category>/...
  Writes corrected copies to website/photos/<category>/...
  Run by update-photos.bat (double-click, at the project root), before
  generate-photos.ps1. See photo-sources/README.txt.

  - Only new or changed photos are reprocessed (cache in tools/.cache).
    Changing SETTINGS or PhotoCorrection.cs reprocesses everything.
    -All forces a full reprocess.
  - A photo named  NN-material.no-correction.jpg  is published as
    NN-material.jpg with no colour change (still rotated, EXIF/GPS stripped).
  - Photos removed from the sources are removed from website/photos.
  - photo-comparison.html (project root) shows before / after.

  NB: this file must stay ASCII (Windows PowerShell 5.1 reads BOM-less .ps1
  files as ANSI). Accented characters are built with [char].
#>
[CmdletBinding()]
param(
  [string]$SourceDir,
  [string]$OutputDir,
  [string]$StateFile,
  [string]$ComparisonFile,
  [switch]$All
)

# ===========================================================================
#  SETTINGS  -  the only place to change how the photos look.
#  After a change, every photo is recomputed on the next run. Then open
#  photo-comparison.html to judge the result.
# ===========================================================================
$SETTINGS = [ordered]@{
  # Backdrop grey after correction (0 = black, 255 = white). 235 = bright
  # off-white that keeps the paper texture. 245 = whiter "catalogue" look.
  BackdropTarget        = 235
  # 0 = no correction, 1 = full correction (0.5 = halfway).
  Strength              = 1.0
  # 0 = keep the backdrop tint (bluish, yellowish...), 1 = perfectly grey backdrop.
  WhiteBalance          = 1.0
  # Limits of the exposure gain (4.0 = about +2 stops, 0.7 = about -0.5 stop).
  # A photo beyond these limits is flagged ("gain capped").
  GainMax               = 4.0
  GainMin               = 0.7
  # Maximum ratio between the red/green/blue gains: limits the correction of a
  # strongly coloured backdrop. 1.25 = 25 %.
  MaxTintShift          = 1.25
  # Black point: blacks are pulled toward BlackTarget with strength
  # BlackStrength, removing at most BlackMax levels.
  BlackTarget           = 8
  BlackStrength         = 0.5
  BlackMax              = 20
  # Gentle contrast below the backdrop (0 = none, 0.3 = strong).
  Contrast              = 0.10
  # Highlight ceiling (0-255): glaze highlights approach it smoothly instead
  # of being clipped to pure white.
  HighlightMax          = 250
  # Width of the border band where the backdrop is measured (0.06 = 6 % of
  # each side, at most 0.45). The pieces must not touch it.
  Border                = 0.06
  # A pixel counts as backdrop only if it is nearly grey (0.12 = 12 %).
  BackdropMaxSaturation = 0.12
  # JPEG quality of the published photos (0-100).
  JpegQuality           = 90
}
# ===========================================================================

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

$c_arrow = [char]0x2192
$c_times = [char]0x00D7

$DECODE_EXT = @('.jpg', '.jpeg', '.png')
$COPY_EXT = @('.webp')
$OUTPUT_EXT = @('.jpg', '.jpeg', '.png', '.webp')
$IGNORED = @('readme.txt', 'thumbs.db', 'desktop.ini', '.ds_store', 'photos.js')
$MARKER = '.no-correction'
$inv = [Globalization.CultureInfo]::InvariantCulture

$script:warnings = New-Object System.Collections.Generic.List[string]
function Add-Warning([string]$msg) { $script:warnings.Add($msg) }

function Stop-WithError([string]$msg) {
  [Console]::Error.WriteLine('Error: ' + $msg)
  exit 1
}

function Get-Sha256([string]$file) {
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
}

function Get-BytesSha256([byte[]]$bytes) {
  $h = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($h.ComputeHash($bytes)) -replace '-', '').ToLower() } finally { $h.Dispose() }
}

# Natural order: leading number (integer), then name (ordinal).
function Get-SortKey([string]$name) {
  $m = [regex]::Match($name, '^(\d+)')
  $num = [int64]::MaxValue
  if ($m.Success) { $num = [int64]$m.Groups[1].Value }
  return [pscustomobject]@{ Num = $num; Name = $name }
}
function Sort-Natural($names) {
  $arr = @($names | ForEach-Object { Get-SortKey $_ })
  $cmp = [Comparison[object]] {
    param($a, $b)
    $c = $a.Num.CompareTo($b.Num)
    if ($c -ne 0) { return $c }
    return [string]::CompareOrdinal($a.Name, $b.Name)
  }
  [Array]::Sort($arr, $cmp)
  return , @($arr | ForEach-Object { $_.Name })
}

function Format-Num([double]$v, [string]$fmt) { return $v.ToString($fmt, $inv) }

function Test-SameOrInside([string]$inner, [string]$outer) {
  $i = $inner.TrimEnd('\') + '\'
  $o = $outer.TrimEnd('\') + '\'
  return $i.StartsWith($o, [StringComparison]::OrdinalIgnoreCase)
}

# Relative URL of $target as seen from folder $fromDir, with encoded segments.
function Get-RelativeUrl([string]$fromDir, [string]$target) {
  $a = @([IO.Path]::GetFullPath($fromDir).TrimEnd('\') -split '\\')
  $b = @([IO.Path]::GetFullPath($target) -split '\\')
  $i = 0
  while ($i -lt $a.Count -and $i -lt $b.Count -and [string]::Equals($a[$i], $b[$i], [StringComparison]::OrdinalIgnoreCase)) { $i++ }
  if ($i -eq 0) { return ([Uri]([IO.Path]::GetFullPath($target))).AbsoluteUri }
  $parts = New-Object System.Collections.Generic.List[string]
  for ($j = $i; $j -lt $a.Count; $j++) { $parts.Add('..') }
  for ($j = $i; $j -lt $b.Count; $j++) { $parts.Add([Uri]::EscapeDataString($b[$j])) }
  return ($parts -join '/')
}

function ConvertTo-HtmlText([string]$s) { return [Net.WebUtility]::HtmlEncode($s) }

# Windows paths ignore case: if $path exists under a differently-cased name
# (case-only rename of a source), return that existing name, else $null.
function Get-OtherCaseName([string]$path) {
  $dir = Split-Path -Parent $path
  $name = Split-Path -Leaf $path
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return $null }
  foreach ($e in [IO.Directory]::EnumerateFileSystemEntries($dir)) {
    $n = [IO.Path]::GetFileName($e)
    if ([string]::Equals($n, $name, [StringComparison]::OrdinalIgnoreCase) -and -not [string]::Equals($n, $name, [StringComparison]::Ordinal)) {
      return $e
    }
  }
  return $null
}

# ---------------------------------------------------------------------------
# Paths

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = Split-Path -Parent $here
if (-not $SourceDir) { $SourceDir = Join-Path $root 'photo-sources' }
if (-not $OutputDir) { $OutputDir = Join-Path $root 'website\photos' }
if (-not $StateFile) { $StateFile = Join-Path $here '.cache\state.json' }
if (-not $ComparisonFile) { $ComparisonFile = Join-Path $root 'photo-comparison.html' }

if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) {
  Stop-WithError "photo source folder not found: $SourceDir. Nothing was changed."
}
$SourceDir = (Resolve-Path -LiteralPath $SourceDir).ProviderPath.TrimEnd('\')
$OutputDir = [IO.Path]::GetFullPath($OutputDir).TrimEnd('\')
$StateFile = [IO.Path]::GetFullPath($StateFile)
$ComparisonFile = [IO.Path]::GetFullPath($ComparisonFile)

if ((Test-SameOrInside $OutputDir $SourceDir) -or (Test-SameOrInside $SourceDir $OutputDir)) {
  Stop-WithError "the output folder ($OutputDir) and the source folder ($SourceDir) must be separate, neither inside the other. Nothing was changed."
}
if ($SETTINGS.Border -gt 0.45 -or $SETTINGS.Border -lt 0) {
  Add-Warning "SETTINGS: Border = $($SETTINGS.Border) is out of range (0 to 0.45); 0.45 or 0 is used instead."
}

# ---------------------------------------------------------------------------
# 1. Inventory of the sources -> planned outputs

$plan = New-Object System.Collections.Generic.List[object]     # photos to produce
$titles = New-Object System.Collections.Generic.List[object]   # title.txt files to copy
$byOutput = @{}

$catNames = Sort-Natural @(Get-ChildItem -LiteralPath $SourceDir -Directory | Where-Object { -not $_.Name.StartsWith('.') } | ForEach-Object { $_.Name })
foreach ($cat in $catNames) {
  $catDir = Join-Path $SourceDir $cat
  foreach ($sub in Get-ChildItem -LiteralPath $catDir -Directory) {
    Add-Warning "Subfolder ignored: $cat/$($sub.Name)"
  }
  $files = @(Get-ChildItem -LiteralPath $catDir -File | ForEach-Object { $_.Name })
  [Array]::Sort($files, [StringComparer]::Ordinal)
  foreach ($name in $files) {
    $lower = $name.ToLower()
    if ($lower -eq 'title.txt') {
      $titles.Add([pscustomobject]@{ Rel = "$cat/$name"; Source = (Join-Path $catDir $name); Output = (Join-Path (Join-Path $OutputDir $cat) 'title.txt') })
      continue
    }
    if ($IGNORED -contains $lower) { continue }
    $ext = [IO.Path]::GetExtension($name).ToLower()
    if (($DECODE_EXT -notcontains $ext) -and ($COPY_EXT -notcontains $ext)) {
      Add-Warning "File ignored (not a .jpg/.jpeg/.png/.webp image): $cat/$name"
      continue
    }
    $base = [IO.Path]::GetFileNameWithoutExtension($name)
    $correct = $true
    if ($base.ToLower().EndsWith($MARKER)) {
      $correct = $false
      $base = $base.Substring(0, $base.Length - $MARKER.Length)
    }
    $copy = $COPY_EXT -contains $ext
    $outExt = '.jpg'
    if ($copy) { $outExt = $ext; $correct = $false }
    $rel = "$cat/$base$outExt"
    $key = $rel.ToLower()
    if ($byOutput.ContainsKey($key)) {
      Add-Warning "Two photos give the same published name $rel`: $($byOutput[$key]) is kept, $cat/$name is ignored."
      continue
    }
    $byOutput[$key] = "$cat/$name"
    if ($copy) {
      Add-Warning "Photo .webp published uncorrected (format not readable by the tool): $cat/$name"
    }
    $plan.Add([pscustomobject]@{
      Rel = $rel; SourceRel = "$cat/$name"; Source = (Join-Path $catDir $name)
      Output = (Join-Path $OutputDir ($rel -replace '/', '\')); Correct = $correct; Copy = $copy
    })
  }
}

if ($plan.Count -eq 0) {
  Stop-WithError "no photo in $SourceDir. Nothing was changed (the site photos are kept)."
}

# ---------------------------------------------------------------------------
# 2. Engine + settings fingerprint

$enginePath = Join-Path $here 'PhotoCorrection.cs'
if (-not ('Isula.PhotoCorrection' -as [type])) {
  Add-Type -TypeDefinition ([IO.File]::ReadAllText($enginePath)) -ReferencedAssemblies System.Drawing
}
$settings = New-Object Isula.Settings
$lines = New-Object System.Collections.Generic.List[string]
foreach ($k in @($SETTINGS.Keys | Sort-Object)) {
  $settings.$k = $SETTINGS[$k]
  $lines.Add($k + '=' + ([double]$SETTINGS[$k]).ToString('R', $inv))
}
$fp = New-Object System.Collections.Generic.List[byte]
$fp.AddRange([IO.File]::ReadAllBytes($enginePath))
$fp.AddRange([Text.Encoding]::UTF8.GetBytes(($lines -join "`n")))
$fingerprint = Get-BytesSha256 $fp.ToArray()

# ---------------------------------------------------------------------------
# 3. Previous state (cache)

$state = @{}
if (Test-Path -LiteralPath $StateFile -PathType Leaf) {
  try {
    $json = ConvertFrom-Json ([IO.File]::ReadAllText($StateFile))
    foreach ($p in $json.photos.PSObject.Properties) { $state[$p.Name] = $p.Value }
  } catch { $state = @{} }
}

# ---------------------------------------------------------------------------
# 4. Correct the new or changed photos

$newState = [ordered]@{}
$nProcessed = 0; $nUnchanged = 0; $errors = 0
foreach ($p in $plan) {
  # Case-only rename (01-A.jpg -> 01-a.jpg): Windows would keep the old name,
  # so rename the category folder and drop the old file first.
  $catOut = Split-Path -Parent $p.Output
  $oldCat = Get-OtherCaseName $catOut
  if ($oldCat) {
    $tmp = $catOut + '.renaming'
    Move-Item -LiteralPath $oldCat -Destination $tmp
    Move-Item -LiteralPath $tmp -Destination $catOut
  }
  $oldFile = Get-OtherCaseName $p.Output
  if ($oldFile -and (Test-Path -LiteralPath $oldFile -PathType Leaf)) { Remove-Item -LiteralPath $oldFile -Force }

  $srcHash = Get-Sha256 $p.Source
  if ($p.Copy) { $key = "$srcHash|copy" } else { $key = "$srcHash|$fingerprint|$($p.Correct)" }
  $old = $state[$p.Rel]
  if (-not $All -and $old -and $old.key -eq $key -and (Test-Path -LiteralPath $p.Output -PathType Leaf)) {
    if ((Get-Sha256 $p.Output) -eq $old.outputSha256) {
      $newState[$p.Rel] = $old
      $nUnchanged++
      if ($old.warning) { Add-Warning "$($p.SourceRel): $($old.warning)" }
      continue
    }
  }

  if (-not (Test-Path -LiteralPath $catOut)) { [void](New-Item -ItemType Directory -Path $catOut) }
  try {
    if ($p.Copy) {
      Copy-Item -LiteralPath $p.Source -Destination $p.Output -Force
      $entry = [ordered]@{ source = $p.SourceRel; key = $key; outputSha256 = ''; correct = $false; copy = $true
        backdrop = $null; backdropAfter = $null; gains = $null; width = 0; height = 0; flags = @('no correction'); warning = $null }
    } else {
      $res = [Isula.PhotoCorrection]::Process($p.Source, $p.Output, $settings, $p.Correct)
      $flags = New-Object System.Collections.Generic.List[string]
      if (-not $p.Correct) { $flags.Add('no correction') }
      elseif (-not $res.BackdropDetected) { $flags.Add('backdrop not detected') }
      if ($res.GainCapped) { $flags.Add('gain capped') }
      if ($res.TintCapped) { $flags.Add('tint capped') }
      $warning = $res.Warning
      if ($res.HadTransparency) {
        $flags.Add('transparency')
        $t = 'transparent areas were filled with white'
        if ($warning) { $warning = "$warning; $t" } else { $warning = $t }
      }
      $entry = [ordered]@{
        source = $p.SourceRel; key = $key; outputSha256 = ''; correct = $p.Correct; copy = $false
        backdrop = @($res.BackdropR, $res.BackdropG, $res.BackdropB)
        backdropAfter = @($res.BackdropAfterR, $res.BackdropAfterG, $res.BackdropAfterB)
        gains = @([Math]::Round($res.GainR, 3), [Math]::Round($res.GainG, 3), [Math]::Round($res.GainB, 3))
        blackRemoved = [Math]::Round($res.BlackRemoved, 1)
        width = $res.Width; height = $res.Height
        flags = $flags.ToArray(); warning = $warning
      }
      if ($res.Width -gt 2500) {
        Add-Warning "$($p.SourceRel): very wide photo ($($res.Width) px), consider reducing it (about 1600 px)."
      }
    }
    $entry.outputSha256 = Get-Sha256 $p.Output
    $newState[$p.Rel] = [pscustomobject]$entry
    $nProcessed++
    if ($entry.warning) { Add-Warning "$($p.SourceRel): $($entry.warning)" }
  } catch {
    $errors++
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
    [Console]::Error.WriteLine("Error: $($p.SourceRel): $msg")
  }
}

foreach ($t in $titles) {
  $dir = Split-Path -Parent $t.Output
  if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
  $same = (Test-Path -LiteralPath $t.Output -PathType Leaf) -and ((Get-Sha256 $t.Source) -eq (Get-Sha256 $t.Output))
  if (-not $same) { Copy-Item -LiteralPath $t.Source -Destination $t.Output -Force }
}

# ---------------------------------------------------------------------------
# 5. Cleanup: only image files and title.txt INSIDE the category folders of
#    OutputDir that no longer come from any source. Never anything at the root
#    of OutputDir (photos.js, README.txt). This point is reached only when the
#    sources contain at least one photo, and is skipped if any photo failed.

$expected = @{}
foreach ($p in $plan) { $expected[$p.Output.ToLower()] = $true }
foreach ($t in $titles) { $expected[$t.Output.ToLower()] = $true }
$nDeleted = 0
if ($errors -eq 0 -and (Test-Path -LiteralPath $OutputDir -PathType Container)) {
  foreach ($d in Get-ChildItem -LiteralPath $OutputDir -Directory) {
    if ($d.Name.StartsWith('.')) { continue }
    foreach ($f in Get-ChildItem -LiteralPath $d.FullName -File) {
      $isImage = $OUTPUT_EXT -contains $f.Extension.ToLower()
      $isTitle = $f.Name.ToLower() -eq 'title.txt'
      if (-not ($isImage -or $isTitle)) { continue }
      if ($expected.ContainsKey($f.FullName.ToLower())) { continue }
      Remove-Item -LiteralPath $f.FullName -Force
      if ($isImage) { $nDeleted++ }
    }
    if (@(Get-ChildItem -LiteralPath $d.FullName -Force).Count -eq 0) {
      Remove-Item -LiteralPath $d.FullName -Force
    }
  }
}

# ---------------------------------------------------------------------------
# 6. State + comparison page

$stateDir = Split-Path -Parent $StateFile
if (-not (Test-Path -LiteralPath $stateDir)) { [void](New-Item -ItemType Directory -Path $stateDir) }
$utf8 = New-Object Text.UTF8Encoding $false
$stateJson = ConvertTo-Json -InputObject ([ordered]@{ version = 1; photos = $newState }) -Depth 6
[IO.File]::WriteAllText($StateFile, $stateJson, $utf8)

function Format-Rgb($a) {
  if ($null -eq $a) { return '?' }
  return (@($a) | ForEach-Object { Format-Num ([double]$_) '0' }) -join ','
}

$htmlDir = Split-Path -Parent $ComparisonFile
$sb = New-Object Text.StringBuilder
[void]$sb.AppendLine('<!doctype html>')
[void]$sb.AppendLine('<html lang="en"><head><meta charset="utf-8">')
[void]$sb.AppendLine('<meta name="viewport" content="width=device-width, initial-scale=1">')
[void]$sb.AppendLine('<title>Photo comparison (before / after)</title>')
[void]$sb.AppendLine('<style>')
[void]$sb.AppendLine('body{margin:0;padding:16px;background:#808080;color:#111;font:14px/1.4 system-ui,sans-serif}')
[void]$sb.AppendLine('h1{font-size:20px;margin:0 0 4px}p.help{margin:0 0 16px}')
[void]$sb.AppendLine('section{margin:0 0 28px}h2{font-size:15px;margin:0 0 6px}')
[void]$sb.AppendLine('.pair{display:flex;gap:8px}.pair figure{flex:1 1 50%;margin:0;min-width:0}')
[void]$sb.AppendLine('.pair img{display:block;width:100%;height:auto}figcaption{font-size:12px;margin-top:2px}')
[void]$sb.AppendLine('.info{font-size:12px;margin-top:4px}.flag{background:#ffd54a;padding:0 4px;border-radius:3px;margin-left:6px}')
[void]$sb.AppendLine('</style></head><body>')
[void]$sb.AppendLine('<h1>Photos: before / after correction</h1>')
[void]$sb.AppendLine('<p class="help">Left: the original (photo-sources). Right: the published photo (website/photos). This file is rebuilt on every run of update-photos.bat.</p>')
foreach ($rel in $newState.Keys) {
  $en = $newState[$rel]
  $before = Get-RelativeUrl $htmlDir (Join-Path $SourceDir ($en.source -replace '/', '\'))
  $after = Get-RelativeUrl $htmlDir (Join-Path $OutputDir ($rel -replace '/', '\'))
  $info = 'backdrop ' + (Format-Rgb $en.backdrop) + ' ' + $c_arrow + ' ' + (Format-Rgb $en.backdropAfter)
  if ($en.gains) { $info += '; gains ' + $c_times + ((@($en.gains) | ForEach-Object { Format-Num ([double]$_) '0.00' }) -join (' / ' + $c_times)) + ' (R/G/B)' }
  [void]$sb.AppendLine('<section>')
  [void]$sb.AppendLine('<h2>' + (ConvertTo-HtmlText $rel) + '</h2>')
  [void]$sb.AppendLine('<div class="pair">')
  [void]$sb.AppendLine('<figure><img loading="lazy" src="' + (ConvertTo-HtmlText $before) + '" alt="before: ' + (ConvertTo-HtmlText $en.source) + '"><figcaption>before</figcaption></figure>')
  [void]$sb.AppendLine('<figure><img loading="lazy" src="' + (ConvertTo-HtmlText $after) + '" alt="after: ' + (ConvertTo-HtmlText $rel) + '"><figcaption>after</figcaption></figure>')
  [void]$sb.AppendLine('</div>')
  $flagsHtml = ''
  foreach ($f in @($en.flags)) { if ($f) { $flagsHtml += '<span class="flag">' + (ConvertTo-HtmlText $f) + '</span>' } }
  [void]$sb.AppendLine('<div class="info">' + (ConvertTo-HtmlText $info) + $flagsHtml + '</div>')
  [void]$sb.AppendLine('</section>')
}
[void]$sb.AppendLine('</body></html>')
if (-not (Test-Path -LiteralPath $htmlDir)) { [void](New-Item -ItemType Directory -Path $htmlDir) }
[IO.File]::WriteAllText($ComparisonFile, $sb.ToString(), $utf8)

# ---------------------------------------------------------------------------
# 7. Summary

foreach ($w in $script:warnings) { Write-Host ('Warning: ' + $w) -ForegroundColor Yellow }
$photoWord = 'photos'
if ($plan.Count -eq 1) { $photoWord = 'photo' }
$summary = "$($plan.Count) $photoWord`: $nProcessed corrected, $nUnchanged unchanged, $nDeleted deleted. Comparison: " + (Split-Path -Leaf $ComparisonFile)
Write-Host $summary
if ($errors -gt 0) {
  [Console]::Error.WriteLine("Error: $errors photo(s) could not be corrected. photos.js is not updated.")
  exit 1
}
exit 0
