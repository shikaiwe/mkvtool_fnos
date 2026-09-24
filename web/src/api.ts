// API 客户端：自动兼容网关前缀（/app/<appname>），开发机为空。
function computeBase(): string {
  let p = location.pathname
  p = p.replace(/\/index\.html$/i, '')
  // hash 路由下 pathname 稳定为挂载目录，如 /app/mkvtoolnix/
  return p.replace(/\/$/, '')
}

export const BASE = computeBase()

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}${BASE}/ws`
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    /* 空响应 */
  }
  if (!res.ok) {
    throw new Error(data?.error || `${method} ${path} failed: ${res.status}`)
  }
  return data as T
}

// ---------- 类型 ----------
export interface Root { path: string; label: string }
export interface FileEntry { name: string; path: string; isDir: boolean; size: number; mtimeMs: number }
export interface Settings {
  concurrency: number
  binDir: string
  defaultOutputDir: string
  uiLanguage: string
  roots: Root[]
}
export interface Job {
  id: string
  name: string
  tool: string
  argv: string[]
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'
  progress: number
  exitCode: number | null
  warning?: boolean
  error?: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  log?: string
}
export interface Track {
  id: number
  type: 'video' | 'audio' | 'subtitles' | string
  codec: string
  properties: Record<string, any>
}
export interface Identification {
  container: { properties: Record<string, any>; type: string }
  tracks: Track[]
  attachments?: any[]
}
export interface Chapter { start: string; end: string; title: string; language: string; startSec: number | null; endSec: number | null }
export interface Edition { name: string; chapters: Chapter[] }
export interface SystemInfo {
  app: { name: string; version: string; dev: boolean }
  node: string
  gatewayPrefix: string
  mkv: { version: string | null; error: string; tools: Record<string, { path: string; source: string }> }
  sys: { version: string; arch: string }
  roots: Root[]
}

// ---------- API ----------
export const api = {
  system: () => request<SystemInfo>('GET', '/api/system'),
  files: (path: string, filter?: 'media') =>
    request<{ path: string; parent: string; roots: Root[]; entries: FileEntry[] }>(
      'GET',
      `/api/files?path=${encodeURIComponent(path)}${filter ? `&filter=${filter}` : ''}`
    ),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', patch),
  jobs: () => request<Job[]>('GET', '/api/jobs'),
  getJob: (id: string) => request<Job>('GET', `/api/jobs/${id}`),
  createJob: (payload: { name: string; tool: string; argv: string[] }) =>
    request<Job>('POST', '/api/jobs', payload),
  cancelJob: (id: string) => request<Job>('POST', `/api/jobs/${id}/cancel`),
  retryJob: (id: string) => request<Job>('POST', `/api/jobs/${id}/retry`),
  deleteJob: (id: string) => request<{ removed: boolean }>('DELETE', `/api/jobs/${id}`),
  identify: (path: string) => request<Identification>('POST', '/api/identify', { path }),
  rawInfo: (path: string, verbose: number) =>
    request<{ exitCode: number; output: string }>('POST', '/api/info/raw', { path, verbose }),
  chaptersFromFile: (path: string) => request<{ editions: Edition[]; xml: string }>(
    'GET',
    `/api/chapters?path=${encodeURIComponent(path)}`
  ),
  chaptersParse: (xml: string) => request<{ editions: Edition[] }>('POST', '/api/chapters/parse', { xml }),
  chaptersTemp: (editions: Edition[]) => request<{ file: string; xml: string }>('PUT', '/api/chapters/temp', { editions }),
}

export function fmtSize(n: number): string {
  if (!n) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtTime(ms: number | null): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleString()
}

// 把命令行文本切成 argv（支持成对引号；开发/高级用法用）
export function tokenizeArgs(text: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}
