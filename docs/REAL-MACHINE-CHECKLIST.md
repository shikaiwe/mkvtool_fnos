# 真机部署与验证清单

> 目标设备：x86_64 fnOS（≥ 1.1.3100，统一网关依赖该最低版本）。

## 0. 前置

- [ ] 测试机有可用的存储卷、管理员账号；不要使用存放重要数据的机器。
- [ ] 应用中心已安装 `nodejs_v22` 运行时（应用的 `install_dep_apps` 会自动带装，确认其存在）。

## 1. 安装

- [ ] 应用中心「手动安装」选择 `mkvtoolnix.fpk`，向导出现「欢迎使用 MKVToolNix」且提示授权目录。
- [ ] 安装完成后应用中心卡片出现 MKVToolNix，且有启动/停止控制（`ctl_stop=true`）。

> 若安装报「应用包不符合系统要求」：先确认 fpk 内 manifest 是 LF 行尾。fnpack 的
> Windows 版会把 manifest 重写成 CRLF，fnOS 解析出的值带 `\r`，架构/版本比对全部
> 失配即报此错。`scripts/build.sh` / `build.ps1` 已自动执行 `scripts/fix-fpk-crlf.sh`
> 修复；手工 `fnpack build` 后需单独跑一次该脚本。

## 2. 服务与入口

- [ ] 桌面出现 MKVToolNix 图标，点击能在 fnOS 窗口内打开界面（统一网关 `/app/mkvtoolnix`）。
- [ ] SSH 到设备：`ls -l /var/apps/mkvtoolnix/target/app.sock` 存在且服务在运行。
- [ ] `appcenter-cli list` / `start` / `stop` 正常；停止后 socket 文件被清理。

## 3. 二进制可用性（重点）

- [ ] SSH 检查执行位与依赖：

  ```bash
  sudo -u mkvtoolnix /var/apps/mkvtoolnix/target/bin/mkvmerge --version
  ldd /var/apps/mkvtoolnix/target/bin/mkvmerge | grep "not found"   # 应无输出
  ```

  若 glibc 版本不满足（AppImage 底线 2.28），`ldd` 会报错——需要改用更老版本源码自行编译。
- [ ] 应用「设置」页显示 MKVToolNix 版本号，四个工具路径均为 `app/bin`。

## 4. 文件访问

- [ ] 应用设置中授权媒体目录后，「提取/信息/混流」页的文件浏览器能看到该目录下的媒体文件。
- [ ] 未授权目录时文件浏览器只有应用数据目录（这是预期的安全边界）。

## 5. 功能用例（真实媒体文件）

- [ ] 信息工具：识别 MKV，容器/轨道/附件信息完整；`mkvinfo -v2` 原始输出正常。
- [ ] 混流：加两个输入文件，改轨道名/语言/默认旗标，选输出目录，提交任务；
      队列页进度实时推进（WebSocket），完成后输出文件可播放、轨道属性正确。
- [ ] 提取：提取字幕与附件到授权目录，文件完整。
- [ ] 属性编辑：改标题/轨道名/旗标，任务成功后 `mkvmerge -J` 复核生效；注意 mkvpropedit 直接改源文件。
- [ ] 章节编辑：从带章节的 MKV 读取 → 修改 → 写回；再用混流把 XML 章节挂进去各验证一次。
- [ ] 并发：并发数设为 2 时同时跑两个任务正常；取消正在运行的任务状态变为「已取消」。

## 6. 生命周期与升级

- [ ] 升级：用新版本号重新打包安装，任务记录保留（`TRIM_PKGVAR/jobs`），中断任务可重试。
- [ ] 卸载后应用数据目录仍保留；重装后任务队列还在。
- [ ] 设备重启后应用可正常自启（fnOS 拉起 cmd/main start）。
