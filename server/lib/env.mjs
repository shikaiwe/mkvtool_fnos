// 环境解析：在 fnOS 上由生命周期脚本注入 TRIM_* 变量；开发机上落到 .dev/ 目录并监听 TCP。
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const isDev = !process.env.TRIM_APPDEST

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const devBase = path.join(repoRoot, '.dev')

// TRIM_DATA_*_PATHS 用冒号分隔（文档约定）；Windows 开发机的盘符路径含冒号，改用分号。
const pathSep = isDev && process.platform === 'win32' ? ';' : ':'
const splitList = (s) =>
  (s || '')
    .split(pathSep)
    .map((x) => x.trim())
    .filter(Boolean)

const appDest = process.env.TRIM_APPDEST || devBase

export const env = {
  dev: isDev,
  repoRoot,
  appName: process.env.TRIM_APPNAME || 'mkvtoolnix',
  appVersion: process.env.TRIM_APPVER || '0.0.0-dev',
  appDest,
  pkgEtc: process.env.TRIM_PKGETC || path.join(devBase, 'etc'),
  pkgVar: process.env.TRIM_PKGVAR || path.join(devBase, 'var'),
  pkgTmp: process.env.TRIM_PKGTMP || path.join(devBase, 'tmp'),
  pkgHome: process.env.TRIM_PKGHOME || path.join(devBase, 'home'),
  sysVersion: process.env.TRIM_SYS_VERSION || '',
  sysArch: process.env.TRIM_SYS_ARCH || '',
  username: process.env.TRIM_USERNAME || '',
  dataAccessiblePaths: splitList(process.env.TRIM_DATA_ACCESSIBLE_PATHS),
  dataSharePaths: splitList(process.env.TRIM_DATA_SHARE_PATHS),
  // 统一网关前缀（设备上为 /app/<appname>；开发机为空）
  gwPrefix: isDev ? '' : '/app/' + (process.env.TRIM_APPNAME || 'mkvtoolnix'),
  wwwDir: isDev
    ? path.join(repoRoot, 'web', 'dist')
    : path.join(appDest, 'www'),
  devBinDir: process.env.MKV_BIN_DIR || '',
  port: Number(process.env.PORT || 8321),
}
