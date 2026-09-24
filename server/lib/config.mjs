// 应用配置：存放在 TRIM_PKGETC/config.json，原子写入。
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'

const CONFIG_FILE = path.join(env.pkgEtc, 'config.json')

export const DEFAULT_CONFIG = Object.freeze({
  // 同时运行的任务数
  concurrency: 2,
  // mkvtoolnix 二进制目录覆盖（空 = 使用包内 app/bin）
  binDir: '',
  // 新建任务时的默认输出目录
  defaultOutputDir: '',
  // 界面语言 zh-CN / en-US
  uiLanguage: 'zh-CN',
})

let cache = null

function load() {
  let saved = {}
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    /* 首次启动或文件损坏时使用默认值 */
  }
  const merged = { ...DEFAULT_CONFIG }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (saved[key] !== undefined && typeof saved[key] === typeof DEFAULT_CONFIG[key]) {
      merged[key] = saved[key]
    }
  }
  return merged
}

export function getConfig() {
  if (!cache) cache = load()
  return { ...cache }
}

export function saveConfig(patch) {
  const next = { ...getConfig() }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (patch[key] !== undefined && typeof patch[key] === typeof DEFAULT_CONFIG[key]) {
      next[key] = patch[key]
    }
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const tmp = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, CONFIG_FILE)
  cache = next
  return { ...next }
}
