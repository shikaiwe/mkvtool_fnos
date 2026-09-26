// 应用运行日志：结构化条目（级别/来源）+ 内存环形缓冲 + JSONL 落盘（带轮转）。
// 每条写入通过 WS broadcast 实时推给前端「日志」页；重启时从磁盘载入历史。
// 旧版本的纯文本日志行在载入时按 info 级别兼容包装。
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'
import { broadcast } from './ws.mjs'

export const LEVELS = ['debug', 'info', 'warn', 'error']
const MAX_ENTRIES = 2000 // 内存缓冲上限
const MAX_BYTES = 2 * 1024 * 1024 // 轮转阈值：app.log 超过后改为 app.log.1
const entries = []
let loaded = false
let bytes = 0 // 当前文件字节数（避免每次写入 stat）

function logFile() {
  return path.join(env.pkgVar, 'logs', 'app.log')
}
function rotatedFile() {
  return path.join(env.pkgVar, 'logs', 'app.log.1')
}

function levelRank(level) {
  const i = LEVELS.indexOf(level)
  return i < 0 ? 1 : i
}

function loadHistory() {
  if (loaded) return
  loaded = true
  try {
    const raw = fs.readFileSync(logFile(), 'utf8')
    bytes = Buffer.byteLength(raw)
    for (const line of raw.split('\n')) {
      if (!line) continue
      try {
        const e = JSON.parse(line)
        if (e && e.ts && e.msg !== undefined) {
          entries.push({ level: 'info', scope: 'app', ...e })
          continue
        }
      } catch {
        /* 非结构化行（旧格式纯文本） */
      }
      const ts = guessTs(line)
      entries.push({ ts, level: 'info', scope: 'app', msg: ts ? line.slice(ts.length + 1) : line })
    }
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  } catch {
    /* 首次运行尚无日志文件 */
  }
}

// 旧格式行首是 ISO 时间戳，尽量提取；提取不到就留空由前端按行渲染
function guessTs(line) {
  const m = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/.exec(line)
  return m ? m[0] : ''
}

function rotate() {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true })
    fs.rmSync(rotatedFile(), { force: true })
    fs.renameSync(logFile(), rotatedFile())
    bytes = 0
  } catch {
    /* 轮转失败不影响继续追加 */
  }
}

// addLog(level, scope, msg, detail?) — detail 为多行补充信息（堆栈、命令输出摘录等）
export function addLog(level, scope, msg, detail = '') {
  loadHistory()
  const entry = {
    ts: new Date().toISOString(),
    level: LEVELS.includes(level) ? level : 'info',
    scope: String(scope || 'app'),
    msg: String(msg),
    ...(detail ? { detail: String(detail).slice(0, 8000) } : {}),
  }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()

  if (level === 'error') console.error(`[${entry.scope}] ${entry.msg}`, detail || '')
  else if (level === 'warn') console.warn(`[${entry.scope}] ${entry.msg}`)
  else console.log(`[${entry.scope}] ${entry.msg}`)

  try {
    const line = JSON.stringify(entry) + '\n'
    if (bytes > MAX_BYTES) rotate()
    fs.appendFileSync(logFile(), line)
    bytes += Buffer.byteLength(line)
  } catch {
    /* 落盘失败不影响运行 */
  }
  broadcast({ type: 'applog', entry })
}

// 返回按 tail/level/q 过滤后的最近条目（level 为最低级别，q 为关键字子串匹配）
export function readLogs({ tail = 1000, level = '', q = '' } = {}) {
  loadHistory()
  const min = levelRank(level)
  const kw = q.trim().toLowerCase()
  const filtered = entries.filter((e) => {
    if (level && levelRank(e.level) < min) return false
    if (kw && !(`${e.msg} ${e.detail || ''}`.toLowerCase().includes(kw))) return false
    return true
  })
  return { entries: filtered.slice(Math.max(0, filtered.length - tail)), file: logFile() }
}

// 下载用：轮转文件 + 当前文件原文（JSONL）
export function readRawLogs() {
  loadHistory()
  let text = ''
  try {
    text += fs.readFileSync(rotatedFile(), 'utf8')
  } catch {
    /* 无轮转文件 */
  }
  try {
    text += fs.readFileSync(logFile(), 'utf8')
  } catch {
    /* 尚无日志 */
  }
  return text
}

// 清空：把当前日志轮转到 .1 并重置内存缓冲之外的历史
export function clearLogs() {
  loadHistory()
  rotate()
  entries.length = 0
  return true
}
