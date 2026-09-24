// 极简 HTTP 框架：路由、JSON 体解析、静态文件托管、网关前缀剥离。
import fs from 'node:fs'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

export function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

export function apiError(res, err) {
  const code = err.statusCode || 500
  if (code >= 500) console.error('[api]', err)
  json(res, code, { error: err.message || String(err) })
}

export function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const raw = await readBody(req)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { statusCode: 400 })
  }
}

export function createRouter() {
  const routes = []
  const add = (method, pattern, handler) => {
    const keys = []
    const regex = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1))
              return '([^/]+)'
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          })
          .join('/') +
        '$'
    )
    routes.push({ method, regex, keys, handler })
  }
  return {
    add,
    routes,
    async handle(req, res, pathname) {
      for (const r of routes) {
        if (req.method !== r.method) continue
        const m = r.regex.exec(pathname)
        if (!m) continue
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
        try {
          const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : null
          await r.handler({ req, res, params, body, query: new URL(req.url, 'http://x').searchParams })
        } catch (err) {
          apiError(res, err)
        }
        return true
      }
      return false
    },
  }
}

function serveFile(res, file, cacheable) {
  const ext = path.extname(file).toLowerCase()
  const stat = fs.statSync(file)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  fs.createReadStream(file).pipe(res)
}

export function serveStatic(res, pathname, wwwDir) {
  if (!fs.existsSync(path.join(wwwDir, 'index.html'))) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<meta charset="utf-8"><body style="font-family:sans-serif"><h3>前端未构建</h3><p>请在开发机执行 scripts/build 后重新安装应用。</p>')
    return
  }
  let rel = decodeURIComponent(pathname)
  if (rel.includes('\0')) return void (res.statusCode = 400) && res.end()
  rel = path.normalize(rel).replace(/^([/\\])+/, '')
  let file = path.resolve(wwwDir, rel)
  if (!file.startsWith(path.resolve(wwwDir))) {
    res.statusCode = 403
    return res.end('Forbidden')
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const cacheable = rel.startsWith('assets' + path.sep) || rel.startsWith('assets/')
    return serveFile(res, file, cacheable)
  }
  // SPA 回退（前端使用 hash 路由，仅兜底）
  serveFile(res, path.join(wwwDir, 'index.html'), false)
}
