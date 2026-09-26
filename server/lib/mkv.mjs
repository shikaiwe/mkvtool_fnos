// mkvtoolnix 命令行工具封装：二进制定位、带库路径的 spawn、识别与版本查询。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'
import { getConfig } from './config.mjs'
import { addLog } from './applog.mjs'

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
const pathFallbackWarned = new Set()
export function resolveTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const dirs = binCandidates()
  for (const dir of dirs) {
    const p = path.join(dir, exe)
    if (fs.existsSync(p)) return { path: p, source: dir }
  }
  // 三个候选目录都没有 → 回退裸命令名走 PATH。静默回退会让设备问题无从排查，这里记一次。
  if (!pathFallbackWarned.has(name)) {
    pathFallbackWarned.add(name)
    addLog('warn', 'mkv', `${name} 未在候选目录中找到，回退 PATH 解析`, `tried:\n${dirs.map((d) => path.join(d, exe)).join('\n')}`)
  }
  return { path: name, source: 'PATH' }
}

// 捆绑库路径（AppImage 解包产物），spawn 时注入 LD_LIBRARY_PATH。
// 同时强制 UTF-8 locale：mkvtoolnix 按 locale 字符集解读命令行参数与输出内容，
// fnOS 应用环境可能没有 LANG（等价 C/ASCII），届时参数会在第一个非 ASCII 字节处被截断
// （表现为中文/日文路径只传到第一个汉字、-J 输出 JSON 中途截断）。glibc ≥2.35 内建 C.UTF-8。
let localeFixedLogged = false
export function spawnEnv() {
  const e = { ...process.env }
  if (process.platform !== 'win32') {
    const cur = `${e.LC_ALL || ''} ${e.LC_CTYPE || ''} ${e.LANG || ''}`
    if (!/utf-?8/i.test(cur)) {
      e.LC_ALL = 'C.UTF-8'
      if (!localeFixedLogged) {
        localeFixedLogged = true
        addLog('info', 'mkv', '子进程 locale 无 UTF-8，已注入 LC_ALL=C.UTF-8（否则非 ASCII 路径/输出会被截断）', `原 LC_ALL=${e.LC_ALL || '(空)'} LANG=${e.LANG || '(空)'}`)
      }
    }
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
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
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

// mkvmerge -J：机器可读的文件识别结果（JSON）。
// 部分文件的元数据/附件名带错误编码字节，会让 -J 输出无法通过 JSON.parse，
// 这里把完整现场写入运行日志（msg + detail），便于设备端排查。
export async function identify(file) {
  const { code, signal, stdout, stderr } = await run('mkvmerge', ['-J', file], { timeoutMs: 60_000 })
  if (signal) {
    addLog('error', 'mkv', `mkvmerge -J 被信号终止: ${signal}`, `file: ${file}\nstdout: ${stdout}\nstderr: ${stderr}`)
    throw new Error(`mkvmerge -J killed by ${signal}`)
  }
  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr.trim() || `mkvmerge -J exited ${code}`)
  }
  if (code !== 0) {
    addLog('warn', 'mkv', `mkvmerge -J exit=${code} 但有 stdout，尝试解析`, `file: ${file}\nstderr: ${stderr}`)
  }
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    addLog('error', 'mkv', `identify: mkvmerge -J 输出无法解析为 JSON (${err.message})`, `file: ${file}\nexit: ${code}\nstdout (${stdout.length} bytes):\n${stdout}\nstderr:\n${stderr}`)
    const excerpt = stdout.trim().slice(0, 120)
    throw new Error(`failed to parse identify output: ${err.message}${excerpt ? ` | output: ${excerpt}` : ''}`)
  }
  // mkvmerge -J 对打不开的文件返回合法 JSON {"errors":[...]}（无 tracks/container）
  if (parsed && Array.isArray(parsed.errors) && parsed.errors.length) {
    const msg = parsed.errors.join('; ').slice(0, 300)
    addLog('error', 'mkv', `identify: mkvmerge 打不开文件`, `file: ${file}\nexit: ${code}\nerrors: ${msg}`)
    throw new Error(msg)
  }
  if (!parsed || !Array.isArray(parsed.tracks) || typeof parsed.container !== 'object' || parsed.container === null) {
    addLog('error', 'mkv', 'identify: mkvmerge -J 输出结构异常（缺少 tracks/container）', `file: ${file}\nexit: ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    throw new Error('unexpected identify result (missing tracks/container), see app log')
  }
  return parsed
}
