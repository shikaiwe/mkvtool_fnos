// 服务入口：
// - fnOS：监听统一网关套接字 ${TRIM_APPDEST}/app.sock（网关前缀 /app/<appname> 会在此剥离）
// - 开发机：监听 TCP（PORT 环境变量，默认 8321），支持 Vite 代理
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { env } from './lib/env.mjs'
import { createRouter, serveStatic, normalizeGatewayUrl } from './lib/httpx.mjs'
import { attachWs, broadcast } from './lib/ws.mjs'
import { registerRoutes } from './api/routes.mjs'
import * as jobs from './lib/jobs.mjs'
import { addLog } from './lib/applog.mjs'

// stdout 镜像一份（设备 journal 可见），结构化条目入运行日志
function log(...args) {
  console.log(new Date().toISOString(), ...args)
}

// ---------- 路由与静态 ----------
const router = createRouter()
registerRoutes(router)

function handler(req, res) {
  let url = req.url || '/'
  // 统一网关会把 /app/<appname>/... 原样转发，这里归一化前缀；同时兼容不带前缀的访问
  const norm = normalizeGatewayUrl(url, env.gwPrefix)
  if (norm.redirect) {
    res.writeHead(302, { Location: norm.redirect })
    return res.end()
  }
  url = norm.url
  let pathname
  try {
    pathname = decodeURIComponent(new URL(url, 'http://x').pathname)
  } catch {
    res.statusCode = 400
    return res.end('Bad Request')
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end('{"ok":true}')
  }

  if (pathname.startsWith('/api/')) {
    router
      .handle(req, res, pathname)
      .then((handled) => {
        if (!handled) {
          addLog('warn', 'api', `404 no route: ${req.method} ${pathname}`)
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `no route: ${req.method} ${pathname}` }))
        }
      })
      .catch((err) => {
        addLog('error', 'api', `router error: ${err.message}`, err.stack || '')
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }
  serveStatic(res, pathname, env.wwwDir)
}

// ---------- 启动 ----------
async function main() {
  addLog('info', 'app', `app start ${env.appName} ${env.appVersion}${env.dev ? ' (dev)' : ''}`, `node: ${process.version}\nwww: ${env.wwwDir}`)
  log('app start', `${env.appName} ${env.appVersion}`, env.dev ? '(dev)' : '')
  for (const dir of [env.pkgVar, env.pkgEtc, env.pkgTmp]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  jobs.init()
  jobs.onChange((job) => broadcast({ type: 'job', job }))
  jobs.onLog((id, line) => broadcast({ type: 'log', id, line }))

  const server = http.createServer(handler)

  if (env.dev) {
    server.listen(env.port, '127.0.0.1', () => {
      addLog('info', 'app', `listening http://127.0.0.1:${env.port} (www: ${env.wwwDir})`)
      log(`[dev] http://127.0.0.1:${env.port}  (www: ${env.wwwDir})`)
    })
  } else {
    const socketPath = path.join(env.appDest, 'app.sock')
    fs.rmSync(socketPath, { force: true })
    server.listen(socketPath, () => {
      try {
        fs.chmodSync(socketPath, 0o660)
      } catch {
        /* 部分文件系统不支持 */
      }
      addLog('info', 'app', `listening on ${socketPath} (gateway prefix ${env.gwPrefix})`)
      log(`listening on ${socketPath} (gateway prefix ${env.gwPrefix})`)
    })
  }

  attachWs(server, ['/ws', env.gwPrefix ? env.gwPrefix + '/ws' : '/ws'])

  const shutdown = (signal) => {
    addLog('info', 'app', `received ${signal}, shutting down`)
    log(`received ${signal}, shutting down`)
    jobs.shutdown()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    addLog('error', 'app', `uncaughtException: ${err.message}`, err.stack || '')
  })
  process.on('unhandledRejection', (err) => {
    addLog('error', 'app', `unhandledRejection: ${err?.message || err}`, err?.stack || String(err))
  })
}

main().catch((err) => {
  console.error('fatal:', err)
  addLog('error', 'app', `fatal: ${err.message}`, err.stack || '')
  if (env.pkgVar && process.env.TRIM_TEMP_LOGFILE) {
    try {
      fs.appendFileSync(process.env.TRIM_TEMP_LOGFILE, `server fatal: ${err.message}\n`)
    } catch {
      /* ignore */
    }
  }
  process.exit(1)
})
