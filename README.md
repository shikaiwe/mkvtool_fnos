# MKVToolNix for fnOS

把 [MKVToolNix](https://mkvtoolnix.download/) 的全部核心能力装进飞牛 fnOS 的 Web 应用：
**内封字幕（主用途）：快速内封（单视频+多字幕，语言/轨道名/字符集自动识别）与批量内封（整季目录自动配对成任务）**，
字幕改名（批量把字幕改名为匹配视频的文件名，配对出错可手动换绑或改新名），
外加完整混流（mkvmerge）、信息查看、轨道/附件/章节提取（mkvextract）、免重混流的属性编辑（mkvpropedit）、章节编辑器、任务队列与实时进度。
前端 Vue 3 + Naive UI（深/浅色主题、中英双语），后端 Node.js 22，底层全部调用官方命令行工具（未修改、原样打包）。

## 安装

到 [Releases](https://github.com/shikaiwe/mkvtool_fnos/releases) 下载 `mkvtoolnix-<版本号>.fpk`，
fnOS 应用中心「手动安装」导入。要求 fnOS ≥ 1.1.3100，且已安装 nodejs_v22 运行时（应用中心会自动处理依赖）。

**装完必须授权目录**：系统设置 → 应用 → MKVToolNix → 文件访问授权，勾选媒体所在目录，否则文件浏览器为空。

## 目录结构

```
├── manifest / config / wizard / cmd   fnpack 打包元数据与生命周期脚本
├── app/ui/                            fnOS 桌面入口（统一网关模式）
├── app/www  app/bin  app/lib  app/server   构建产物（不入 git，见 scripts/build）
├── server/                            Node 后端源码（任务队列 / API / WebSocket）
├── web/                               Vue 3 前端源码
└── scripts/                           构建、打包、二进制管线、图标生成
```

## 本地构建（开发机）

1. 安装依赖：Node.js ≥ 22（本机已验证 22.19）、npm；解包 AppImage 需要 7-Zip（脚本会自动找
   `PATH` → `E:\A_project\7-Zip-Zstandard` → `C:\Program Files\7-Zip`）。
2. 下载打包工具（约 4MB）：

   ```powershell
   iwr https://static2.fnnas.com/fnpack/fnpack-1.2.3-windows-amd64 -OutFile tools\fnpack.exe
   ```

3. 一键构建：

   ```powershell
   powershell -File scripts\build.ps1
   ```

   脚本会依次：构建前端 → 组装后端（含 `node_modules`）→ 下载 MKVToolNix 官方 AppImage 并提取
   CLI 二进制与捆绑库 → 调用 `fnpack build` 生成 `mkvtoolnix-<版本号>.fpk`（版本号取自 manifest）。
   Linux/WSL/fnOS 设备上用 `scripts/build.sh`（需要 `fnpack` 与 `curl`）。

4. 发版：推送 `v*` 标签（如 `v0.2.0`）后，GitHub Actions 自动构建并把 `.fpk` 发布到 Releases
   （同时附带 `THIRD-PARTY-LICENSES.md`）。

## 日常开发

```bash
# 开发机本机调试（无需重打 fpk）
npm --prefix server install
node server/index.mjs                # 后端 http://127.0.0.1:8321（默认走 web/dist）
npm --prefix web run dev             # Vite 5273 端口，/api 与 /ws 自动代理
# 本机装有 MKVToolNix Windows 版时，让后端用它：
MKV_BIN_DIR="C:\Program Files\MKVToolNix" node server/index.mjs
# 开发模式下把测试目录挂进文件浏览器（分号分隔多个）：
MKV_DEV_ROOTS="E:\some\test\dir" node server/index.mjs
```

改完代码要更新 NAS：重跑 `scripts\build.ps1` → 重新安装 `.fpk`（改代码不重装是常见坑）。

## 合规

- 本封装层：MIT。MKVToolNix 本体：GPL-2.0；捆绑的 libebml/libmatroska：LGPL。
- 二进制**不做任何修改**，由构建脚本从官方 AppImage 原样提取；许可文本与来源见包内
  `licenses/` 与 `app/bin/SOURCES.txt`，详见 [THIRD-PARTY-LICENSES.md](./THIRD-PARTY-LICENSES.md)。
- Release 分发时随包附带 `THIRD-PARTY-LICENSES.md`，仓库公开即可满足源码提供义务。
