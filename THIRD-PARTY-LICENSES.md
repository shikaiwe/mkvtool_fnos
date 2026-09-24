# 第三方组件与许可声明

本仓库包含的代码分为两部分：**本封装层**（本仓库原创代码）与**打包时引入的第三方二进制**。

## 1. 本封装层（MIT）

- 仓库内容：`server/`、`web/src/`、`cmd/`、`scripts/`、`manifest`、`config/`、`wizard/`、`app/ui/`
- 许可：MIT（见 [LICENSE](./LICENSE)）
- 本封装层通过**子进程调用**官方 mkvtoolnix 命令行工具（`mkvmerge` / `mkvinfo` / `mkvextract` / `mkvpropedit`），
  与 MKVToolNix 不构成同一程序的衍生作品（mere aggregation），但为尊重上游，建议修改本仓库时同样保持开放源码。

## 2. MKVToolNix 官方二进制（GPL-2.0）

- 上游：<https://mkvtoolnix.download/>
- 源码：<https://mkvtoolnix.download/source.html>（GitLab / Codeberg 镜像：`mbunkus/mkvtoolnix`）
- 许可：GPL-2.0（`COPYING`）
- 引入方式：`scripts/prepare-binaries` 在构建时下载官方发布的 AppImage（**未做任何修改**），
  解包其中的 `mkvmerge`、`mkvinfo`、`mkvextract`、`mkvpropedit` 及捆绑库放入 `app/bin`、`app/lib`。
- 分发义务：一旦将含二进制的 `.fpk` 分发给他人（例如发布到 GitHub Releases），必须同时附带 GPL-2.0 许可文本
  并提供对应源码的获取方式（指向官方源码页即可，因为二进制未修改）。构建脚本会把许可文本放入包内 `licenses/`
  目录、把来源信息写入 `app/bin/SOURCES.txt`，请勿删除。

## 3. 捆绑库（LGPL-2.1+ / LGPL-3.0）

MKVToolNix 官方构建内部捆绑了 `libebml`、`libmatroska` 等库（LGPL 授权），随二进制一并解包引入。
对应许可文本随包发布于 `licenses/` 目录（`LGPL-2.1.txt`、`LGPL-3.0.txt`）。
LGPL 库以动态链接方式使用，反向工程所需的信息可由上游源码获得，符合 LGPL 第 4/6 条要求。

## 4. 其他依赖

- `server/node_modules`：`ws`（WebSocket 实现，MIT）
- `web`：Vue 3（MIT）、Naive UI（MIT）、vue-router（MIT）、vue-i18n（MIT）、Vite（MIT）
- 以上均为 MIT 许可，未修改源码；`fnpack` 为飞牛官方打包工具，仅在开发机使用、不随包分发。
