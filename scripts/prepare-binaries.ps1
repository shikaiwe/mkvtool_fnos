# Download the official MKVToolNix release and extract CLI binaries + bundled libs
# into the packaging directories: app/bin, app/lib, app/licenses, app/bin/SOURCES.txt
# Binaries are NOT committed to git; they are produced before packaging only.
param(
    [string]$Version = '102.0',
    [string]$SevenZip = ''
)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$RootPath = $Root.Path
$Tools = Join-Path $RootPath 'tools'
$AppBin = Join-Path $RootPath 'app\bin'
$AppLib = Join-Path $RootPath 'app\lib'
$AppLic = Join-Path $RootPath 'app\licenses'
New-Item -ItemType Directory -Force -Path $Tools, $AppBin, $AppLib, $AppLic | Out-Null

# ---- locate 7-Zip (an AppImage is a squashfs image; unpack with 7z on Windows) ----
if (-not $SevenZip) {
    $candidates = @()
    $cmd7z = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if ($cmd7z) { $candidates += $cmd7z.Source }
    $candidates += 'E:\A_project\7-Zip-Zstandard\7z.exe'
    $candidates += 'C:\Program Files\7-Zip\7z.exe'
    $candidates = @($candidates | Where-Object { $_ -and (Test-Path $_) })
    if ($candidates.Count -eq 0) { throw '7z.exe not found; pass -SevenZip <path>' }
    $SevenZip = $candidates[0]
}
Write-Host "7-Zip: $SevenZip"

# ---- download the official AppImage (unmodified redistribution) ----
$Url = "https://mkvtoolnix.download/appimage/MKVToolNix_GUI-$Version-x86_64.AppImage"
$AppImage = Join-Path $Tools "MKVToolNix_GUI-$Version-x86_64.AppImage"
if (-not (Test-Path $AppImage)) {
    Write-Host "downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $AppImage
}

# ---- unpack ----
$ExtractDir = Join-Path $Tools 'appimage-extract'
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null
& $SevenZip x -y "-o$ExtractDir" $AppImage | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z failed on $AppImage" }
# 7z 直接把 squashfs 内容解到目录根部（usr/...）；--appimage-extract 则会多一层 squashfs-root/
if (Test-Path (Join-Path $ExtractDir 'usr')) {
    $TopDir = $ExtractDir
} else {
    $TopDir = (Get-ChildItem $ExtractDir -Directory | Select-Object -First 1).FullName
}
$UsrPath = Join-Path $TopDir 'usr'

# ---- copy the CLI tools (the GUI is not needed on a headless NAS) ----
$binSrc = Join-Path $UsrPath 'bin'
foreach ($name in 'mkvmerge', 'mkvinfo', 'mkvextract', 'mkvpropedit') {
    $exe = Get-ChildItem $binSrc -Filter "$name*" | Select-Object -First 1
    if (-not $exe) { throw "$name not found in AppImage" }
    Copy-Item $exe.FullName (Join-Path $AppBin $exe.Name) -Force
    Write-Host "bin <- $($exe.Name)"
}

# ---- copy bundled libs (AppRun relies on them at runtime) ----
$libSrc = Join-Path $UsrPath 'lib'
if (Test-Path $libSrc) {
    Copy-Item (Join-Path $libSrc '*') $AppLib -Recurse -Force
    Write-Host "lib <- $libSrc"
}

# ---- license texts + source info (GPL compliance) ----
$licFiles = @(
    @{ Url = 'https://codeberg.org/mbunkus/mkvtoolnix/raw/branch/main/COPYING'; Out = 'MKVToolNix-COPYING-GPL-2.0' },
    @{ Url = 'https://codeberg.org/mbunkus/mkvtoolnix/raw/branch/main/doc/licenses/LGPL-2.1.txt'; Out = 'LGPL-2.1.txt' },
    @{ Url = 'https://codeberg.org/mbunkus/mkvtoolnix/raw/branch/main/doc/licenses/LGPL-3.0.txt'; Out = 'LGPL-3.0.txt' }
)
foreach ($f in $licFiles) {
    try {
        Invoke-WebRequest -Uri $f.Url -OutFile (Join-Path $AppLic $f.Out)
        Write-Host "license <- $($f.Out)"
    } catch {
        Write-Warning "license download failed (packaging continues, but you must ship licenses when distributing): $($f.Url)"
    }
}

@"
tool: MKVToolNix CLI
version: $Version
upstream: https://mkvtoolnix.download/
source: https://mkvtoolnix.download/source.html
package: $Url
license: GPL-2.0 (mkvtoolnix), LGPL-2.1+ (bundled libebml/libmatroska etc.)
note: unmodified official binaries, extracted from the AppImage above
"@ | Set-Content (Join-Path $AppBin 'SOURCES.txt') -Encoding ascii

Write-Host 'done: app/bin, app/lib, app/licenses are ready.'
