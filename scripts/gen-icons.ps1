# 从 assets/icon-source.png 生成 fnOS 所需的图标文件
# 输出：ICON.PNG(64) ICON_256.PNG(256) app/ui/images/icon_64.png icon_256.png
# fnOS 要求：正方形画布、sRGB、单张不超过 1024KB
param(
    [string]$Source,
    [string]$Root
)
$ErrorActionPreference = 'Stop'
if (-not $Source) { $Source = Join-Path $PSScriptRoot "..\assets\icon-source.png" }
if (-not $Root) { $Root = Join-Path $PSScriptRoot ".." }
Add-Type -AssemblyName System.Drawing

$srcPath = (Resolve-Path $Source).Path
$src = [System.Drawing.Image]::FromFile($srcPath)
try {
    foreach ($size in 64, 256) {
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::AssumeLinear
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.DrawImage($src, 0, 0, $size, $size)
        } finally {
            $g.Dispose()
        }
        $targets = @((Join-Path $Root ("app\ui\images\icon_{0}.png" -f $size)))
        if ($size -eq 64) { $targets += (Join-Path $Root "ICON.PNG") }
        if ($size -eq 256) { $targets += (Join-Path $Root "ICON_256.PNG") }
        foreach ($t in $targets) {
            $dir = Split-Path $t -Parent
            if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            $bmp.Save($t, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        $bmp.Dispose()
    }
    Write-Host "icons generated from $srcPath"
} finally {
    $src.Dispose()
}
