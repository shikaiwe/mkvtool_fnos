// 应用运行日志：内存环形缓冲 + pkgVar/logs/app.log 落盘，供前端「日志」页直接查看。
// 上次运行的历史在首次读取/写入时载入内存，重启不丢。
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'

const MAX_LINES = 2000
const lines = []
let loaded = false

function logFile() {
  return path.join(env.pkgVar, 'logs', 'app.log')
}

function loadHistory() {
  if (loaded) return
  loaded = true
  try {
    for (const l of fs.readFileSync(logFile(), 'utf8').split('\n')) {
      if (l) lines.push(l)
    }
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
  } catch {
    /* 首次运行尚无日志文件 */
  }
}

function fmt(v) {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack || v.message
  return String(v)
}

export function addLog(...parts) {
  const line = [new Date().toISOString(), ...parts.map(fmt)].join(' ')
  loadHistory()
  lines.push(line)
  if (lines.length > MAX_LINES) lines.shift()
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true })
    fs.appendFileSync(logFile(), line + '\n')
  } catch {
    /* 落盘失败不影响运行 */
  }
}

// 返回最近 tail 行与日志文件位置
export function readLogs(tail = 500) {
  loadHistory()
  return { lines: lines.slice(Math.max(0, lines.length - tail)), file: logFile() }
}
