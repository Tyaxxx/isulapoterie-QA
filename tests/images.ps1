<#
  Test helper (dev only): creates synthetic images and measures zones.

  -Action create  -Out <f> [-Width 240] [-Height 180] -Backdrop r,g,b [-Pot r,g,b]
                  [-Highlight] [-Orientation n] [-Noise] [-RedCorner] [-Transparent]
      Plain backdrop, centred "pot" ellipse (40% x 50% of the frame), a 24x24
      highlight (250,250,250) at the centre of the pot, top-left quarter red
      (-RedCorner), EXIF tag 0x0112 (-Orientation), deterministic +-3 noise
      (-Noise), fully transparent backdrop (-Transparent, PNG only).
      .png -> PNG, anything else -> JPEG quality 100.
  -Action measure -In <f>[|<f>...] [-Zones "x,y,w,h;..."]
      Prints JSON {width, height, orientation, zones:[{r,g,b}]} (zone means).
      A zone may use negative x/y, counted from the right/bottom edge.
      -Band <fraction> adds band:{r,g,b}, the per-channel median of the whole
      border band (no masking).
      With several files (separated by |), prints a JSON array of those objects.

  ASCII only (Windows PowerShell 5.1).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('create', 'measure')][string]$Action,
  [string]$Out,
  [string]$In,
  [int]$Width = 240,
  [int]$Height = 180,
  [string]$Backdrop = '200,200,200',
  [string]$Pot,
  [switch]$Highlight,
  [int]$Orientation = 0,
  [switch]$Noise,
  [switch]$RedCorner,
  [switch]$Transparent,
  [string]$Zones = '',
  [double]$Band = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
public static class TestZones {
  public static double[] Mean(byte[] buf, int stride, int x0, int y0, int w, int h) {
    double r = 0, g = 0, b = 0; long n = 0;
    for (int y = y0; y < y0 + h; y++) {
      int o = y * stride + x0 * 3;
      for (int x = 0; x < w; x++, o += 3) { b += buf[o]; g += buf[o + 1]; r += buf[o + 2]; n++; }
    }
    return new double[] { r / n, g / n, b / n };
  }
  // Per-channel median of the whole border band (fraction of each side), no masking.
  public static int[] BandMedian(byte[] buf, int stride, int w, int h, double frac) {
    int bw = Math.Max(1, (int)Math.Round(w * frac)), bh = Math.Max(1, (int)Math.Round(h * frac));
    int[,] hist = new int[3, 256]; long n = 0;
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        if (y >= bh && y < h - bh && x >= bw && x < w - bw) continue;
        int o = y * stride + x * 3;
        hist[0, buf[o + 2]]++; hist[1, buf[o + 1]]++; hist[2, buf[o]]++; n++;
      }
    int[] med = new int[3];
    for (int c = 0; c < 3; c++) { long cum = 0; for (int i = 0; i < 256; i++) { cum += hist[c, i]; if (cum * 2 >= n) { med[c] = i; break; } } }
    return med;
  }
}
'@

function ConvertTo-Rgb([string]$s) {
  $p = @($s -split ',' | ForEach-Object { [int]$_.Trim() })
  return [Drawing.Color]::FromArgb($p[0], $p[1], $p[2])
}

if ($Action -eq 'create') {
  $format = [Drawing.Imaging.PixelFormat]::Format24bppRgb
  if ($Transparent) { $format = [Drawing.Imaging.PixelFormat]::Format32bppArgb }
  $bmp = New-Object Drawing.Bitmap $Width, $Height, $format
  $g = [Drawing.Graphics]::FromImage($bmp)
  if ($Transparent) { $g.Clear([Drawing.Color]::Transparent) } else { $g.Clear((ConvertTo-Rgb $Backdrop)) }
  if ($RedCorner) {
    $br = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 0, 0))
    $g.FillRectangle($br, 0, 0, [int]($Width / 2), [int]($Height / 2))
    $br.Dispose()
  }
  if ($Pot) {
    $pw = [int]($Width * 0.4); $ph = [int]($Height * 0.5)
    $br = New-Object Drawing.SolidBrush (ConvertTo-Rgb $Pot)
    $g.FillEllipse($br, [int](($Width - $pw) / 2), [int](($Height - $ph) / 2), $pw, $ph)
    $br.Dispose()
  }
  if ($Highlight) {
    $br = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(250, 250, 250))
    $g.FillRectangle($br, [int]($Width / 2 - 12), [int]($Height / 2 - 12), 24, 24)
    $br.Dispose()
  }
  $g.Dispose()

  if ($Noise) {
    $rect = New-Object Drawing.Rectangle 0, 0, $Width, $Height
    $d = $bmp.LockBits($rect, [Drawing.Imaging.ImageLockMode]::ReadWrite, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $n = [Math]::Abs($d.Stride) * $Height
    $buf = New-Object byte[] $n
    [Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $n)
    $rnd = New-Object Random 1
    for ($i = 0; $i -lt $n; $i++) {
      $v = [int]$buf[$i] + $rnd.Next(-3, 4)
      if ($v -lt 0) { $v = 0 } elseif ($v -gt 255) { $v = 255 }
      $buf[$i] = [byte]$v
    }
    [Runtime.InteropServices.Marshal]::Copy($buf, 0, $d.Scan0, $n)
    $bmp.UnlockBits($d)
  }

  if ($Orientation -gt 0) {
    $pi = [Runtime.Serialization.FormatterServices]::GetUninitializedObject([Drawing.Imaging.PropertyItem])
    $pi.Id = 0x0112; $pi.Type = 3; $pi.Len = 2
    $pi.Value = [byte[]]@([byte]$Orientation, 0)
    $bmp.SetPropertyItem($pi)
  }

  if ([IO.Path]::GetExtension($Out).ToLower() -eq '.png') {
    $bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png)
  } else {
    $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]100)
    $bmp.Save($Out, $codec, $ep)
  }
  $bmp.Dispose()
  exit 0
}

# measure
function Measure-File([string]$file) {
  $fs = New-Object IO.FileStream $file, ([IO.FileMode]::Open), ([IO.FileAccess]::Read), ([IO.FileShare]::Read)
  try {
    $img = [Drawing.Image]::FromStream($fs, $false, $false)
    $orient = 0
    if ($img.PropertyIdList -contains 0x0112) { $orient = [int]$img.GetPropertyItem(0x0112).Value[0] }
    $w = $img.Width; $h = $img.Height
    $rect = New-Object Drawing.Rectangle 0, 0, $w, $h
    $d = $img.LockBits($rect, [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $stride = [Math]::Abs($d.Stride)
    $buf = New-Object byte[] ($stride * $h)
    [Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $buf.Length)
    $img.UnlockBits($d)
    $img.Dispose()
  } finally { $fs.Dispose() }

  $res = New-Object System.Collections.Generic.List[object]
  foreach ($z in @($Zones -split ';' | Where-Object { $_.Trim() -ne '' })) {
    $p = @($z -split ',' | ForEach-Object { [int]$_.Trim() })
    $x = $p[0]; $y = $p[1]
    if ($x -lt 0) { $x = $w + $x }
    if ($y -lt 0) { $y = $h + $y }
    $m = [TestZones]::Mean($buf, $stride, $x, $y, $p[2], $p[3])
    $res.Add([ordered]@{ r = [Math]::Round($m[0], 2); g = [Math]::Round($m[1], 2); b = [Math]::Round($m[2], 2) })
  }
  $m = [ordered]@{ width = $w; height = $h; orientation = $orient; zones = $res.ToArray() }
  if ($Band -gt 0) {
    $bm = [TestZones]::BandMedian($buf, $stride, $w, $h, $Band)
    $m.band = [ordered]@{ r = $bm[0]; g = $bm[1]; b = $bm[2] }
  }
  return $m
}

$files = @($In -split '\|' | Where-Object { $_.Trim() -ne '' })
if ($files.Count -eq 1) {
  $result = Measure-File $files[0]
} else {
  $result = @($files | ForEach-Object { Measure-File $_ })
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Depth 5 -Compress))
exit 0
