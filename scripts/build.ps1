# One-shot build of the .fpk: frontend -> backend (with vendored deps)
# -> mkvtoolnix binaries (if missing) -> fnpack build
param(
    [string]$Fnpack = '',
    [switch]$SkipBinaries
)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$RootPath = $Root.Path
Push-Location $RootPath
try {
    Write-Host '==> build frontend (web)'
    if (-not (Test-Path 'web\node_modules')) {
        npm --prefix web install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install (web) failed' }
    }
    npm --prefix web run build
    if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }
    if (Test-Path 'app\www') { Remove-Item -Recurse -Force 'app\www' }
    Copy-Item -Recurse 'web\dist' 'app\www'

    Write-Host '==> prepare backend (server)'
    if (-not (Test-Path 'server\package-lock.json')) {
        npm --prefix server install --no-audit --no-fund
    }
    if (Test-Path 'app\server') { Remove-Item -Recurse -Force 'app\server' }
    New-Item -ItemType Directory -Force -Path 'app\server' | Out-Null
    Copy-Item 'server\package.json' 'app\server\'
    Copy-Item 'server\package-lock.json' 'app\server\'
    Copy-Item -Recurse 'server\lib' 'app\server\lib'
    Copy-Item -Recurse 'server\api' 'app\server\api'
    Copy-Item 'server\index.mjs' 'app\server\'
    npm --prefix app\server ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci (app/server) failed' }

    $hasBin = (Test-Path 'app\bin\mkvmerge') -or (Test-Path 'app\bin\mkvmerge.exe')
    if (-not $hasBin) {
        if ($SkipBinaries) {
            Write-Warning 'binaries skipped (-SkipBinaries): the built app cannot run mkv commands'
        } else {
            Write-Host '==> prepare mkvtoolnix binaries (prepare-binaries)'
            & (Join-Path $PSScriptRoot 'prepare-binaries.ps1')
        }
    }

    if (-not $Fnpack) {
        $Fnpack = Join-Path $RootPath 'tools\fnpack.exe'
        $cmdFnpack = Get-Command fnpack.exe -ErrorAction SilentlyContinue
        if (-not (Test-Path $Fnpack) -and $cmdFnpack) { $Fnpack = $cmdFnpack.Source }
    }
    if (-not (Test-Path $Fnpack)) {
        throw 'fnpack not found; download fnpack-1.2.3-windows-amd64 to tools\fnpack.exe (see README)'
    }
    Write-Host "==> fnpack build ($Fnpack)"
    & $Fnpack build
    if ($LASTEXITCODE -ne 0) { throw 'fnpack build failed' }
    Write-Host 'build done.'
} finally {
    Pop-Location
}
