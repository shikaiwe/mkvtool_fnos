#!/usr/bin/env bash
# 一键构建 .fpk（Linux / WSL / fnOS 设备上运行）
# 用法：scripts/build.sh [--skip-binaries]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SKIP=false
[ "${1:-}" = "--skip-binaries" ] && SKIP=true

echo '==> 构建前端 (web)'
[ -d web/node_modules ] || npm --prefix web install --no-audit --no-fund
npm --prefix web run build
rm -rf app/www
cp -r web/dist app/www

echo '==> 准备后端 (server)'
[ -f server/package-lock.json ] || npm --prefix server install --no-audit --no-fund
rm -rf app/server
mkdir -p app/server
cp server/package.json server/package-lock.json app/server/
cp -r server/lib server/api app/server/
cp server/index.mjs app/server/
npm --prefix app/server ci --omit=dev --no-audit --no-fund

if [ ! -e app/bin/mkvmerge ] && [ "$SKIP" != true ]; then
  echo '==> 准备 mkvtoolnix 二进制 (prepare-binaries)'
  bash scripts/prepare-binaries.sh
fi

FNPACK="${FNPACK:-fnpack}"
command -v "$FNPACK" >/dev/null 2>&1 || FNPACK="$ROOT/tools/fnpack"
echo "==> fnpack build ($FNPACK)"
"$FNPACK" build
echo '构建完成。'
