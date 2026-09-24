// mkvtoolnix 命令行工具封装：二进制定位、带库路径的 spawn、识别与版本查询。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'
import { getConfig } from './config.mjs'

export const TOOLS = ['mkvmerge', 'mkvinfo', 'mkvextract', 'mkvpropedit']

function binCandidates() {
  const dirs = []
  const cfg = getConfig()
  if (cfg.binDir) dirs.push(cfg.binDir)
  if (env.devBinDir) dirs.push(env.devBinDir)
  dirs.push(path.join(env.appDest, 'bin'))
  return dirs
}

// 返回 { path, source } 或 null（找不到时回退 PATH）
export function resolveTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  for (const dir of binCandidates()) {
    const p = path.join(dir, exe)
    if (fs.existsSync(p)) return { path: p, source: dir }
  }
  return { path: name, source: 'PATH' }
}

// 捆绑库路径（AppImage 解包产物），spawn 时注入 LD_LIBRARY_PATH
export function spawnEnv() {
  const e = { ...process.env }
  if (process.platform !== 'win32') {
    const libs = [
      path.join(env.appDest, 'lib'),
      path.join(env.appDest, 'lib', 'x86_64-linux-gnu'),
    ].filter((p) => fs.existsSync(p))
    if (libs.length) {
      e.LD_LIBRARY_PATH = [...libs, e.LD_LIBRARY_PATH].filter(Boolean).join(':')
    }
  }
  return e
}

export function run(tool, args, { timeoutMs = 120_000 } = {}) {
  const { path: bin } = resolveTool(tool)
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: spawnEnv() })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      child.kill('SIGKILL')
      reject(Object.assign(new Error(`${tool} timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }))
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

// 流式运行：逐行回调（stdout 与 stderr 都回调，isErr 区分来源）
export function runLines(tool, args, { onLine, skipLines = 0 } = {}) {
  const { path: bin } = resolveTool(tool)
  const child = spawn(bin, args, { env: spawnEnv() })
  let skipped = 0
  const wire = (stream, isErr) => {
    let buf = ''
    stream.setEncoding('utf8')
    stream.on('data', (d) => {
      buf += d
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        if (skipped < skipLines && !isErr) {
          skipped++
          continue
        }
        onLine?.(line, isErr)
      }
    })
    stream.on('end', () => {
      if (buf) onLine?.(buf.replace(/\r$/, ''), isErr)
    })
  }
  wire(child.stdout, false)
  wire(child.stderr, true)
  return child
}

export async function version() {
  const { code, stdout } = await run('mkvmerge', ['--version'], { timeoutMs: 15_000 })
  if (code !== 0) throw new Error(`mkvmerge --version exited ${code}`)
  return stdout.trim()
}

export function toolStatus() {
  const out = {}
  for (const t of TOOLS) {
    const r = resolveTool(t)
    out[t] = { path: r.path, source: r.source }
  }
  return out
}

// mkvmerge -J：机器可读的文件识别结果（JSON）
export async function identify(file) {
  const { code, stdout, stderr } = await run('mkvmerge', ['-J', file], { timeoutMs: 60_000 })
  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr.trim() || `mkvmerge -J exited ${code}`)
  }
  try {
    return JSON.parse(stdout)
  } catch (err) {
    throw new Error(`failed to parse identify output: ${err.message}`)
  }
}
