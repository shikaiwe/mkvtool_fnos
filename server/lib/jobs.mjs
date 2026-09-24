// 任务引擎：队列 + 并发控制 + 进度解析 + 日志落盘 + WS 事件。
// 任务以 argv 形式存储（argv[0] 必须是 mkv 工具名，spawn 数组形式调用，不经 shell）。
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'
import { getConfig } from './config.mjs'
import { resolveTool, runLines, TOOLS } from './mkv.mjs'
import { isAllowed } from './paths.mjs'

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
    emitChange(job)
    pump()
  })

  child.on('close', (code, signal) => {
    children.delete(job.id)
    job.exitCode = code
    job.finishedAt = Date.now()
    if (cancelRequested.has(job.id)) {
      cancelRequested.delete(job.id)
      job.status = 'canceled'
    } else if (code === 0) {
      job.status = 'done'
      job.progress = 100
    } else if (code === 1) {
      // mkvmerge：0=成功 1=有警告 2=出错
      job.status = 'done'
      job.warning = true
    } else {
      job.status = 'failed'
      job.error = signal ? `killed by ${signal}` : `exit code ${code}`
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
  for (const suffix of ['.job.json', '.log']) {
    fs.rmSync(path.join(JOBS_DIR, id + suffix), { force: true })
  }
  return true
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
