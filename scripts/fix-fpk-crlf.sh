#!/usr/bin/env bash
# 修复 fnpack(Windows 版)重写 manifest 时写入 CRLF 行尾的问题。
# fnOS 在 Linux 上解析 manifest,值末尾残留的 \r 会让 platform / os_min_version
# 等比对全部失配,安装时报「应用包不符合系统要求」。
# 说明:manifest 里的 checksum 是 fnpack 对 app.tgz 算的 md5,本脚本不改 app.tgz,
# 因此不影响校验。Linux 上 fnpack 写的是 LF,本脚本检测到无 CRLF 时是空操作。
# 注意:检测/改写必须走 perl 的 raw 模式 —— Windows 上的 grep(ugrep)读文件
# 会默认做 CRLF 文本转换,永远"看不见" \r。
# 用法:scripts/fix-fpk-crlf.sh [fpk 路径],默认 mkvtoolnix.fpk
set -euo pipefail
FPK="${1:-mkvtoolnix.fpk}"
[ -f "$FPK" ] || { echo "错误: 找不到 $FPK" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 记下原始成员顺序,重打包时保持一致
mapfile -t MEMBERS < <(tar -tzf "$FPK")
tar -xzf "$FPK" -C "$WORK"

shopt -s nullglob
TEXT_FILES=("$WORK/manifest" "$WORK/LICENSE" "$WORK"/cmd/* "$WORK"/config/* "$WORK"/wizard/*)
[ ${#TEXT_FILES[@]} -gt 0 ] || { echo "错误: 包内没有文本成员" >&2; exit 1; }

FIX_LOG="$(perl -e '
  for my $f (@ARGV) {
    open(my $in, "<:raw", $f) or next;
    local $/; my $d = <$in>; close $in;
    next unless defined $d && index($d, "\r") >= 0;
    my $n = $d; $n =~ s/\r\n/\n/g;
    open(my $out, ">:raw", $f) or next;
    print {$out} $n; close $out;
    print "fixed\t$f\n";
  }
' "${TEXT_FILES[@]}")"

if [ -z "$FIX_LOG" ]; then
  echo "未检测到 CRLF,$FPK 无需处理。"
  exit 0
fi
echo "$FIX_LOG" | sed "s|$WORK/||"

# 权限规范化为 Linux 惯例:目录/脚本 755,其余文件 644
find "$WORK" -type d -exec chmod 755 {} +
find "$WORK" -type f -exec chmod 644 {} +
[ -d "$WORK/cmd" ] && chmod 755 "$WORK"/cmd/* || true

( cd "$WORK" && tar --format=ustar --no-recursion --owner=0 --group=0 \
    -cf - "${MEMBERS[@]}" ) | gzip -9n > "$FPK.part"
tar -tzf "$FPK.part" >/dev/null   # 完整性自检
mv -f "$FPK.part" "$FPK"

# 终检:manifest 必须不含 \r 字节(用 perl raw 模式逐字节验证)
if tar -xzOf "$FPK" manifest | perl -e 'binmode STDIN; local $/; my $d = <STDIN>; exit(index($d, "\r") >= 0 ? 1 : 0)'; then
  echo "重打包完成,manifest 已是 LF: $FPK"
else
  echo "错误: 重打包后 manifest 仍含 CR" >&2
  exit 1
fi
