#!/usr/bin/env bash
# 下载 MKVToolNix 官方发布包并提取 CLI 二进制 + 捆绑库到打包目录（Linux / WSL / fnOS）
# 用法：scripts/prepare-binaries.sh [版本号，默认 102.0]
set -euo pipefail
VERSION="${1:-102.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
APPBIN="$ROOT/app/bin"
APPLIB="$ROOT/app/lib"
APPLIC="$ROOT/app/licenses"
mkdir -p "$TOOLS" "$APPBIN" "$APPLIB" "$APPLIC"

URL="https://mkvtoolnix.download/appimage/MKVToolNix_GUI-$VERSION-x86_64.AppImage"
APPIMAGE="$TOOLS/MKVToolNix_GUI-$VERSION-x86_64.AppImage"

if [ ! -f "$APPIMAGE" ]; then
  echo "下载 $URL"
  curl -fL --retry 3 -o "$APPIMAGE" "$URL"
fi
chmod +x "$APPIMAGE"

# 官方自解压（无需 FUSE）
EXTRACT="$TOOLS/appimage-extract"
rm -rf "$EXTRACT"
(cd "$TOOLS" && "./$(basename "$APPIMAGE")" --appimage-extract >/dev/null)
USR="$EXTRACT/squashfs-root/usr"

for name in mkvmerge mkvinfo mkvextract mkvpropedit; do
  found="$(find "$USR/bin" -maxdepth 1 -name "$name*" | head -n 1)"
  [ -n "$found" ] || { echo "未找到 $name"; exit 1; }
  cp "$found" "$APPBIN/"
  echo "bin <- $(basename "$found")"
done

if [ -d "$USR/lib" ]; then
  cp -r "$USR/lib/." "$APPLIB/"
  echo "lib <- $USR/lib"
fi

# 许可文本（GPL 合规）
fetch() { curl -fsSL --retry 3 -o "$APPLIC/$2" "$1" && echo "license <- $2" || echo "警告: 许可文本下载失败 $1"; }
fetch "https://codeberg.org/mbunkus/mkvtoolnix/raw/branch/main/COPYING" "MKVToolNix-COPYING-GPL-2.0" || true
fetch "https://codeberg.org/mbunkus/mkvtoolnix/raw/branch/main/doc/licenses/LGPL-2.1.txt" "LGPL-2.1.txt" || true
fetch "https://codeberg.org/mbunkus/mkvtoolnix/raw/branch/main/doc/licenses/LGPL-3.0.txt" "LGPL-3.0.txt" || true

cat > "$APPBIN/SOURCES.txt" <<EOF
tool: MKVToolNix CLI
version: $VERSION
upstream: https://mkvtoolnix.download/
source: https://mkvtoolnix.download/source.html
package: $URL
license: GPL-2.0 (mkvtoolnix), LGPL-2.1+ (bundled libebml/libmatroska etc.)
note: unmodified official binaries, extracted from the AppImage above
EOF

echo "完成。app/bin、app/lib、app/licenses 已就绪。"
