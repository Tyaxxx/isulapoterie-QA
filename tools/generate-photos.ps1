<#
  Generates website/photos/photos.js from the (corrected) photo folders.
  Run by update-photos.bat (double-click, at the project root), after
  correct-photos.ps1. See photo-sources/README.txt.

  Convention:
    photos/<NN-category-name>/<NN-material>.jpg
    - NN (leading digits) sets the order; "03b" sorts between 03 and 04.
    - The rest of the folder name gives the title (words separated by - _ or
      space, joined with " - "). A title.txt file (1st line, UTF-8) overrides it.
    - The rest of the photo name gives the caption: faience -> Faience (with
      diaeresis), gres -> Gres (with grave accent), other words kept as is.
      Titles and captions are visitor-facing, so they stay in French.

  NB: this file must stay ASCII (Windows PowerShell 5.1 reads BOM-less .ps1
  files as ANSI). Accented characters are built with [char].
#>
[CmdletBinding()]
param(
  [string]$PhotosDir,
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

# Accented characters (ASCII-only source)
$c_e_grave = [char]0x00E8   # e grave
$c_i_diaeresis = [char]0x00EF   # i diaeresis
$c_dash    = [char]0x2014   # em dash

$CAPTION_WORDS = @{
  'faience' = 'Fa' + $c_i_diaeresis + 'ence'
  'gres'    = 'Gr' + $c_e_grave + 's'
}
$IMAGE_EXT = @('.jpg', '.jpeg', '.png', '.webp')
$IGNORED = @('readme.txt', 'title.txt', 'thumbs.db', 'desktop.ini', '.ds_store', 'photos.js')

$script:warnings = New-Object System.Collections.Generic.List[string]
function Add-Warning([string]$msg) { $script:warnings.Add($msg) }

function Remove-Accents([string]$s) {
  $n = $s.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object Text.StringBuilder
  foreach ($ch in $n.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$sb.Append($ch)
    }
  }
  return $sb.ToString().Normalize([Text.NormalizationForm]::FormC)
}

function Capitalize([string]$s) {
  if ($s.Length -eq 0) { return $s }
  return $s.Substring(0, 1).ToUpper() + $s.Substring(1)
}

# Splits "03b-gres" into { Num = 3 ; Prefix = "03b" ; Rest = "gres" }
function Split-Name([string]$name) {
  $m = [regex]::Match($name, '^(\d+)([a-zA-Z](?=[-_ ]|$))?[-_ ]*(.*)$')
  if ($m.Success) {
    return @{ Num = [int64]$m.Groups[1].Value; Prefix = ($m.Groups[1].Value + $m.Groups[2].Value).ToLower(); Rest = $m.Groups[3].Value }
  }
  return @{ Num = [int64]::MaxValue; Prefix = ''; Rest = $name.Trim() }
}

function Get-Words([string]$s) {
  return @($s -split '[-_ ]+' | Where-Object { $_ -ne '' })
}

function Test-NameIssues([string]$name, [string]$what) {
  $issues = @()
  if ($name -match ' ') { $issues += 'space' }
  if ((Remove-Accents $name) -ne $name) { $issues += 'accent' }
  if ($name -cmatch '[A-Z]') { $issues += 'uppercase' }
  if ($issues.Count -gt 0) {
    Add-Warning ("$what `"$name`": " + ($issues -join ', ') + " in the name (accepted, but prefer lowercase, no accents, no spaces).")
  }
}

function Sort-ByName($items) {
  # Order: leading number (integer), then name (ordinal)
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($it in $items) {
    $p = Split-Name ([IO.Path]::GetFileNameWithoutExtension($it.Name))
    if ($it.PSIsContainer) { $p = Split-Name $it.Name }
    $list.Add([pscustomobject]@{ Item = $it; Num = $p.Num; Name = $it.Name; Parts = $p })
  }
  $arr = $list.ToArray()
  $cmp = [Comparison[object]] {
    param($a, $b)
    $c = $a.Num.CompareTo($b.Num)
    if ($c -ne 0) { return $c }
    return [string]::CompareOrdinal($a.Name, $b.Name)
  }
  [Array]::Sort($arr, $cmp)
  return , $arr
}

function Get-CategoryTitle([string]$rest) {
  $words = @(Get-Words $rest)
  return (($words | ForEach-Object { Capitalize $_ }) -join ' - ')
}

function Get-Caption([string]$rest) {
  $words = @(Get-Words $rest)
  if ($words.Count -eq 0) { return '' }
  $out = @()
  foreach ($w in $words) {
    $key = (Remove-Accents $w).ToLower()
    if ($CAPTION_WORDS.ContainsKey($key)) { $out += $CAPTION_WORDS[$key] } else { $out += $w }
  }
  return Capitalize ($out -join ' ')
}

function Get-Slug([string]$s) {
  $s = (Remove-Accents $s).ToLower()
  $s = [regex]::Replace($s, '[^a-z0-9]+', '-').Trim('-')
  return $s
}

# ---------------------------------------------------------------------------

if (-not $PhotosDir) {
  $here = $PSScriptRoot
  if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
  $PhotosDir = Join-Path $here '..\website\photos'
}
if (-not (Test-Path -LiteralPath $PhotosDir -PathType Container)) {
  [Console]::Error.WriteLine("Error: photo folder not found: $PhotosDir")
  exit 1
}
$PhotosDir = (Resolve-Path -LiteralPath $PhotosDir).ProviderPath
if (-not $OutFile) { $OutFile = Join-Path $PhotosDir 'photos.js' }

$categories = New-Object System.Collections.Generic.List[object]
$total = 0
$usedIds = @{}

$dirs = Sort-ByName @(Get-ChildItem -LiteralPath $PhotosDir -Directory | Where-Object { -not $_.Name.StartsWith('.') })
foreach ($d in $dirs) {
  $dir = $d.Item
  Test-NameIssues $dir.Name 'Folder'
  $rest = $d.Parts.Rest
  $id = Get-Slug $rest
  if (-not $id) { $id = Get-Slug $dir.Name }
  if (-not $id) { $id = 'categorie' }
  $baseId = $id; $k = 2
  while ($usedIds.ContainsKey($id)) { $id = "$baseId-$k"; $k++ }

  $title = Get-CategoryTitle $rest
  $titleFile = Join-Path $dir.FullName 'title.txt'
  if (Test-Path -LiteralPath $titleFile) {
    $lines = [IO.File]::ReadAllLines($titleFile, [Text.Encoding]::UTF8) | Where-Object { $_.Trim() -ne '' }
    if (@($lines).Count -gt 0) { $title = @($lines)[0].Trim() }
  }
  if (-not $title) { $title = $dir.Name }

  $images = New-Object System.Collections.Generic.List[object]
  foreach ($f in Get-ChildItem -LiteralPath $dir.FullName -File) {
    $lower = $f.Name.ToLower()
    if ($IGNORED -contains $lower) { continue }
    if ($IMAGE_EXT -contains $f.Extension.ToLower()) { $images.Add($f) }
    else { Add-Warning "File ignored (not a .jpg/.jpeg/.png/.webp image): $($dir.Name)/$($f.Name)" }
  }
  foreach ($sub in Get-ChildItem -LiteralPath $dir.FullName -Directory) {
    Add-Warning "Subfolder ignored: $($dir.Name)/$($sub.Name)"
  }
  if ($images.Count -eq 0) {
    Add-Warning "Folder without photos, ignored: $($dir.Name)"
    continue
  }
  $usedIds[$id] = $true

  $photos = New-Object System.Collections.Generic.List[object]
  $seen = @{}
  foreach ($p in (Sort-ByName $images.ToArray())) {
    $f = $p.Item
    Test-NameIssues $f.Name 'Photo'
    if ($p.Parts.Prefix -eq '') {
      Add-Warning "Photo without a leading number (placed last): $($dir.Name)/$($f.Name)"
    } elseif ($seen.ContainsKey($p.Parts.Prefix)) {
      Add-Warning "Duplicate number ($($p.Parts.Prefix)) in $($dir.Name): $($seen[$p.Parts.Prefix]) and $($f.Name)"
    } else { $seen[$p.Parts.Prefix] = $f.Name }
    $photos.Add([ordered]@{
      src     = 'photos/' + $dir.Name + '/' + $f.Name
      caption = (Get-Caption $p.Parts.Rest)
      # Version = start of the file's hash. The site appends it as ?v=... so browsers
      # (and GitHub Pages caches) fetch a photo again as soon as its content changes.
      v       = (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash.Substring(0, 8).ToLowerInvariant()
    })
  }
  $total += $photos.Count
  $categories.Add([ordered]@{ id = $id; title = $title; photos = $photos.ToArray() })
}

$data = [ordered]@{ categories = $categories.ToArray() }
$json = ConvertTo-Json -InputObject $data -Depth 6 -Compress

$header = '// Generated by update-photos.bat: do not edit by hand.'
$content = $header + "`n" + 'window.ISULA_PHOTOS = ' + $json + ";`n"
[IO.File]::WriteAllText($OutFile, $content, (New-Object Text.UTF8Encoding $false))

foreach ($w in $script:warnings) { Write-Host ('Warning: ' + $w) -ForegroundColor Yellow }
$catWord = 'category'
if ($categories.Count -ne 1) { $catWord = 'categories' }
$photoWord = 'photo'
if ($total -ne 1) { $photoWord += 's' }
Write-Host ("$($categories.Count) $catWord, $total $photoWord " + $c_dash + ' photos.js updated.')
exit 0
