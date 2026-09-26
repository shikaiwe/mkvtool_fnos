// 任务引擎：队列 + 并发控制 + 进度解析 + 日志落盘 + WS 事件。
// 任务以 argv 形式存储（argv[0] 必须是 mkv 工具名，spawn 数组形式调用，不经 shell）。
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'
import { getConfig } from './config.mjs'
import { resolveTool, runLines, TOOLS } from './mkv.mjs'
import { isAllowed } from './paths.mjs'
import { addLog } from './applog.mjs'

const JOBS_DIR = path.join(env.pkgVar, 'jobs')
const QUEUED_STATUSES = new Set(['queued', 'running'])

// #GUI#progress 42% / Progress: 42%
const PROGRESS_RE = /(?:#GUI#progress|Progress:)\s+(\d{1,3}(?:\.\d+)?)\s*%/i

let jobs = new Map() // id -> job
let children = new Map() // id -> ChildProcess
let cancelRequested = new Set()
let listeners = { change: [], log: [] }

function persist(job) {
  fs.writeFileSync(path.join(JOBS_DIR, `${job.id}.job.json`), JSON.stringify(job, null, 2))
}

function emitChange(job) {
  persist(job)
  listeners.change.forEach((fn) => fn(job))
}

function appendLog(job, line) {
  fs.appendFileSync(path.join(JOBS_DIR, `${job.id}.log`), line + '\n')
}

export function init() {
  fs.mkdirSync(JOBS_DIR, { recursive: true })
  for (const f of fs.readdirSync(JOBS_DIR)) {
    if (!f.endsWith('.job.json')) continue
    try {
      const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8'))
      if (QUEUED_STATUSES.has(job.status)) {
        // 上次进程退出时任务仍在运行 → 标记中断，可手动重试
        job.status = 'interrupted'
        job.finishedAt = Date.now()
        job.error = 'interrupted by app restart'
        addLog('error', 'job', `任务中断（应用重启）: ${job.name}`, `id: ${job.id}\ntool: ${job.tool}\nargv: ${job.argv.join(' ')}`)
      }
      jobs.set(job.id, job)
    } catch {
      /* 跳过损坏的任务文件 */
    }
  }
}

export function onChange(fn) {
  listeners.change.push(fn)
}
export function onLog(fn) {
  listeners.log.push(fn)
}

export function list() {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
}
export function get(id) {
  return jobs.get(id) || null
}

export function logPath(job) {
  return path.join(JOBS_DIR, `${job.id}.log`)
}

export function readLogTail(job, lines = 300) {
  try {
    const raw = fs.readFileSync(logPath(job), 'utf8')
    const arr = raw.split('\n')
    return arr.slice(Math.max(0, arr.length - 1 - lines)).join('\n')
  } catch {
    return ''
  }
}

// 安全校验：argv 必须以白名单工具开头；内嵌的绝对路径必须落在允许的根之内。
function validateArgv(tool, argv) {
  if (!TOOLS.includes(tool)) throw Object.assign(new Error(`tool not allowed: ${tool}`), { statusCode: 400 })
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
    throw Object.assign(new Error('argv must be a non-empty string array'), { statusCode: 400 })
  }
  if (argv.length > 4096) throw Object.assign(new Error('argv too long'), { statusCode: 400 })

  const candidates = []
  for (const arg of argv) {
    if (arg.startsWith('/')) candidates.push(arg)
    const m = /^\d+:(\/.+)$/.exec(arg) // mkvextract 的 TID:/path/out 形式
    if (m) candidates.push(m[1])
    const eq = arg.indexOf('=')
    if (eq > 0 && arg.slice(eq + 1).startsWith('/')) candidates.push(arg.slice(eq + 1))
  }
  if (env.dev) return // 开发机放开（配合 MKV_DEV_ROOTS）
  for (const p of candidates) {
    if (!isAllowed(p)) {
      throw Object.assign(new Error(`path not allowed: ${p}`), { statusCode: 403 })
    }
  }
}

export function create({ name, tool, argv }) {
  validateArgv(tool, argv)
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  const job = {
    id,
    name: String(name || `${tool} ${new Date().toLocaleString()}`).slice(0, 200),
    tool,
    argv,
    status: 'queued',
    progress: 0,
    exitCode: null,
    error: '',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  }
  jobs.set(id, job)
  addLog('info', 'job', `任务创建: ${job.name}`, `id: ${job.id}\ntool: ${tool}\nargv: ${argv.join(' ')}`)
  emitChange(job)
  pump()
  return job
}

function concurrency() {
  return Math.max(1, Math.min(8, Number(getConfig().concurrency) || 2))
}

function pump() {
  const running = [...jobs.values()].filter((j) => j.status === 'running').length
  let slots = concurrency() - running
  const next = [...jobs.values()]
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const job of next) {
    if (slots <= 0) break
    slots--
    start(job)
  }
}

function start(job) {
  const { path: bin } = resolveTool(job.tool)
  const args = [...job.argv]
  if (job.tool === 'mkvmerge' && !args.includes('--gui-mode')) args.push('--gui-mode')

  job.status = 'running'
  job.startedAt = Date.now()
  addLog('info', 'job', `任务开始: ${job.name}`, `id: ${job.id}\n$ ${job.tool} ${args.join(' ')}`)
  appendLog(job, `$ ${job.tool} ${args.join(' ')}`)
  emitChange(job)

  const child = runLines(job.tool, args, {
    onLine: (line, isErr) => {
      const m = PROGRESS_RE.exec(line)
      if (m) {
        const pct = Math.max(0, Math.min(100, Number(m[1])))
        if (pct !== job.progress) {
          job.progress = pct
          emitChange(job)
        }
      }
      // 捕获工具输出的真实错误行（mkvmerge --gui-mode 的 #GUI#error、本地化的 错误:/Error: 前缀），
      // 让任务列表/失败日志显示具体原因，而不是只有 exit code 2
      const trimmed = line.trim()
      if (/^(?:#GUI#error|错误[:：]|Error[:：])/i.test(trimmed)) {
        job.error = trimmed.slice(0, 300)
      }
      appendLog(job, line)
      listeners.log.forEach((fn) => fn(job.id, line))
    },
  })
  children.set(job.id, child)

  child.on('error', (err) => {
    children.delete(job.id)
    job.status = 'failed'
    job.error = `spawn failed: ${err.message}`
    job.finishedAt = Date.now()
    addLog('error', 'job', `任务失败: ${job.name} — ${job.error}`, `id: ${job.id}\ntool: ${job.tool}\nargv: ${job.argv.join(' ')}`)
    appendLog(job, `! ${job.error}`)
    emitChange(job)
    pump()
  })

  child.on('close', (code, signal) => {
    children.delete(job.id)
    job.exitCode = code
    job.finishedAt = Date.now()
    const dur = job.startedAt ? Math.round((job.finishedAt - job.startedAt) / 1000) : 0
    const durText = `${dur}s`
    if (cancelRequested.has(job.id)) {
      cancelRequested.delete(job.id)
      job.status = 'canceled'
      addLog('warn', 'job', `任务取消: ${job.name}（运行 ${durText}）`, `id: ${job.id}`)
      appendLog(job, `! canceled`)
    } else if (code === 0) {
      job.status = 'done'
      job.progress = 100
      addLog('info', 'job', `任务完成: ${job.name}（${durText}）`, `id: ${job.id}`)
    } else if (code === 1) {
      // mkvmerge/mkvextract/mkvpropedit/mkvinfo 均为：0=成功 1=有警告 2=出错
      job.status = 'done'
      job.warning = true
      addLog('warn', 'job', `任务完成（有警告）: ${job.name}（exit 1，${durText}）`, `id: ${job.id}\n${readLogTail(job, 8)}`)
    } else {
      job.status = 'failed'
      // 已从输出捕获到具体错误行时优先展示，并附上退出码
      const exitText = signal ? `signal ${signal}` : `exit code ${code}`
      job.error = job.error ? `${job.error} [${exitText}]` : exitText
      addLog('error', 'job', `任务失败: ${job.name} — ${job.error}（${durText}）`, `id: ${job.id}\n${readLogTail(job, 12)}`)
      appendLog(job, `! ${job.error}`)
    }
    emitChange(job)
    pump()
  })
}

export function cancel(id) {
  const job = jobs.get(id)
  if (!job) throw Object.assign(new Error('job not found'), { statusCode: 404 })
  if (job.status !== 'running') return job
  cancelRequested.add(id)
  addLog('info', 'job', `请求取消任务: ${job.name}`, `id: ${id}`)
  const child = children.get(id)
  if (child) {
    child.kill('SIGTERM')
    setTimeout(() => {
      if (cancelRequested.has(id)) child.kill('SIGKILL')
    }, 10_000).unref()
  }
  return job
}

export function retry(id) {
  const old = jobs.get(id)
  if (!old) throw Object.assign(new Error('job not found'), { statusCode: 404 })
  if (old.status === 'running' || old.status === 'queued') {
    throw Object.assign(new Error('job still active'), { statusCode: 400 })
  }
  return create({ name: old.name, tool: old.tool, argv: old.argv })
}

export function remove(id) {
  const job = jobs.get(id)
  if (!job) throw Object.assign(new Error('job not found'), { statusCode: 404 })
  if (job.status === 'running' || job.status === 'queued') {
    throw Object.assign(new Error('cancel the job before removing'), { statusCode: 400 })
  }
  jobs.delete(id)
  addLog('debug', 'job', `任务记录已删除: ${job.name}`, `id: ${id}`)
  for (const suffix of ['.job.json', '.log']) {
    fs.rmSync(path.join(JOBS_DIR, id + suffix), { force: true })
  }
  return true
}

// 一键清理已结束的任务记录（done/failed/canceled/interrupted），排队/运行中的不动
export function clearFinished() {
  const ids = [...jobs.values()]
    .filter((j) => !QUEUED_STATUSES.has(j.status))
    .map((j) => j.id)
  for (const id of ids) remove(id)
  if (ids.length) addLog('info', 'job', `一键清理已完成任务记录 × ${ids.length}`)
  return ids.length
}

export function shutdown() {
  for (const [id, child] of children) {
    cancelRequested.add(id)
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
}
