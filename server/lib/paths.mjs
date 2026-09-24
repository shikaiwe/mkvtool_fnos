// 文件系统访问边界：仅允许「用户授权目录 + 应用数据目录」，所有读写路径必须落在这些根之内。
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env.mjs'

export function allowedRoots() {
  const roots = []
  const seen = new Set()
  const push = (p, label) => {
    if (!p || seen.has(p)) return
    seen.add(p)
    roots.push({ path: p, label })
  }
  env.dataAccessiblePaths.forEach((p, i) => push(p, `authorized-${i + 1}`))
  env.dataSharePaths.forEach((p, i) => push(p, `share-${i + 1}`))
  push(env.pkgVar, 'app-data')
  push(env.pkgTmp, 'app-tmp')
  push(env.pkgHome, 'app-home')
  if (env.dev) {
    // 开发机：允许访问仓库目录与 MKV_DEV_ROOTS（分号分隔）
    push(env.repoRoot, 'repo')
    if (process.env.MKV_DEV_ROOTS) {
      process.env.MKV_DEV_ROOTS.split(';')
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((p, i) => push(p, `dev-${i + 1}`))
    }
  }
  return roots
}

function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function isAllowed(target) {
  if (!target || typeof target !== 'string') return false
  if (target.includes('\0')) return false
  const abs = path.resolve(target)
  return allowedRoots().some((r) => isInside(r.path, abs))
}

export function assertAllowed(target) {
  if (!isAllowed(target)) {
    const err = new Error(`path not allowed: ${target}`)
    err.statusCode = 403
    throw err
  }
  return path.resolve(target)
}

export function listDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    let size = 0
    let mtimeMs = 0
    try {
      const st = fs.statSync(full)
      size = st.size
      mtimeMs = st.mtimeMs
      if (e.isFile() === false && e.isDirectory() === false) continue
    } catch {
      continue
    }
    out.push({ name: e.name, path: full, isDir: e.isDirectory(), size, mtimeMs })
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return out
}

// 常见媒体/字幕/章节文件扩展名（文件浏览器的"仅媒体"过滤）
export const MEDIA_EXTENSIONS = new Set([
  'mkv', 'mka', 'mks', 'mk3d', 'webm',
  'mp4', 'm4v', 'mov', 'ts', 'm2ts', 'mts', 'avi', 'flv', 'ogv',
  'mp3', 'flac', 'aac', 'ogg', 'opus', 'wav', 'm4a', 'dts', 'ac3', 'thd', 'dtshd', 'eac3', 'truehd',
  'srt', 'ass', 'ssa', 'sub', 'sup', 'vtt', 'idx', 'smi',
  'xml', 'mpl', 'txt', 'cue',
])
