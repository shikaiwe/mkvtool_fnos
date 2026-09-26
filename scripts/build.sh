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

# fnpack(Windows 版)写出的 CRLF manifest 与 0666 app.tgz 都已实证无害
# (真机对照:原生包 R1/R0 可装,凡经 tar 重打包的 W 系列全被拒)。
# 不要在 fnpack 输出后对 .fpk 做任何解包/重打包——那正是安装失败的原因。
# （仅 mv 改名不影响包内容，是安全的）

# 输出文件名带上版本号（版本取自 manifest）
VERSION="$(grep -E '^version=' manifest | head -n1 | cut -d= -f2 | tr -d '[:space:]')"
if [ -f mkvtoolnix.fpk ] && [ -n "$VERSION" ]; then
  mv -f mkvtoolnix.fpk "mkvtoolnix-$VERSION.fpk"
fi
echo "构建完成：mkvtoolnix-$VERSION.fpk"
