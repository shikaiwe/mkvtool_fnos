// REST API 路由。所有路径参数均经过 allowed-roots 校验；任务以白名单工具 + argv 形式提交。
import fs from 'node:fs'
import path from 'node:path'
import { json } from '../lib/httpx.mjs'
import { env } from '../lib/env.mjs'
import { getConfig, saveConfig, DEFAULT_CONFIG } from '../lib/config.mjs'
import { allowedRoots, assertAllowed, listDir, MEDIA_EXTENSIONS } from '../lib/paths.mjs'
import * as jobs from '../lib/jobs.mjs'
import { toolStatus, version, identify, run } from '../lib/mkv.mjs'
import { parseChaptersXml, buildChaptersXml } from '../lib/chapters.mjs'
import { detectSubCharset } from '../lib/subcharset.mjs'
import { readLogs, readRawLogs, clearLogs, addLog } from '../lib/applog.mjs'

export function registerRoutes(router) {
  // ---------- 系统信息 ----------
  router.add('GET', '/api/system', async ({ res }) => {
    let mkvVersion = null
    let mkvError = ''
    try {
      mkvVersion = await version()
    } catch (err) {
      mkvError = err.message
    }
    json(res, 200, {
      app: { name: env.appName, version: env.appVersion, dev: env.dev },
      node: process.version,
      gatewayPrefix: env.gwPrefix,
      mkv: { version: mkvVersion, error: mkvError, tools: toolStatus() },
      sys: { version: env.sysVersion, arch: env.sysArch },
      roots: allowedRoots(),
    })
  })

  // ---------- 文件浏览 ----------
  router.add('GET', '/api/files', async ({ res, query }) => {
    const p = query.get('path')
    const filter = query.get('filter') // '' | 'media'
    if (!p) {
      return json(res, 200, { path: '', roots: allowedRoots(), entries: [] })
    }
    const dir = assertAllowed(p)
    let st
    try {
      st = fs.statSync(dir)
    } catch {
      throw Object.assign(new Error('path not found'), { statusCode: 404 })
    }
    if (!st.isDirectory()) throw Object.assign(new Error('not a directory'), { statusCode: 400 })
    let entries = listDir(dir)
    if (filter === 'media') {
      entries = entries.filter(
        (e) => e.isDir || MEDIA_EXTENSIONS.has(e.name.split('.').pop().toLowerCase())
      )
    }
    const parent = path.dirname(dir)
    json(res, 200, {
      path: dir,
      parent: parent !== dir && allowedRoots().some((r) => dir.startsWith(r.path)) ? parent : '',
      roots: allowedRoots(),
      entries,
    })
  })

  // ---------- 设置 ----------
  router.add('GET', '/api/settings', async ({ res }) => {
    json(res, 200, { ...getConfig(), roots: allowedRoots() })
  })
  router.add('PUT', '/api/settings', async ({ res, body }) => {
    const patch = {}
    if (body.concurrency !== undefined) {
      const n = Number(body.concurrency)
      if (!Number.isInteger(n) || n < 1 || n > 8) {
        throw Object.assign(new Error('concurrency must be 1-8'), { statusCode: 400 })
      }
      patch.concurrency = n
    }
    for (const key of ['binDir', 'defaultOutputDir']) {
      if (body[key] !== undefined) patch[key] = String(body[key]).slice(0, 1024)
    }
    if (body.uiLanguage !== undefined) {
      if (!['zh-CN', 'en-US'].includes(body.uiLanguage)) {
        throw Object.assign(new Error('unsupported uiLanguage'), { statusCode: 400 })
      }
      patch.uiLanguage = body.uiLanguage
    }
    json(res, 200, saveConfig(patch))
  })

  // ---------- 任务 ----------
  router.add('GET', '/api/jobs', async ({ res }) => {
    json(res, 200, jobs.list())
  })
  // 一键清理已结束的任务记录（放在 :id 路由前注册）
  router.add('POST', '/api/jobs/clear-finished', async ({ res }) => {
    json(res, 200, { removed: jobs.clearFinished() })
  })
  router.add('POST', '/api/jobs', async ({ req, res, body }) => {
    const job = jobs.create({ name: body.name, tool: body.tool, argv: body.argv })
    json(res, 201, job)
  })
  router.add('GET', '/api/jobs/:id', async ({ res, params }) => {
    const job = jobs.get(params.id)
    if (!job) throw Object.assign(new Error('job not found'), { statusCode: 404 })
    json(res, 200, { ...job, log: jobs.readLogTail(job) })
  })
  router.add('POST', '/api/jobs/:id/cancel', async ({ res, params }) => {
    json(res, 200, jobs.cancel(params.id))
  })
  router.add('POST', '/api/jobs/:id/retry', async ({ res, params }) => {
    json(res, 201, jobs.retry(params.id))
  })
  router.add('DELETE', '/api/jobs/:id', async ({ res, params }) => {
    json(res, 200, { removed: jobs.remove(params.id) })
  })

  // ---------- 识别 / 信息 ----------
  router.add('POST', '/api/identify', async ({ res, body }) => {
    const file = assertAllowed(String(body.path || ''))
    let st
    try {
      st = fs.statSync(file)
    } catch {
      throw Object.assign(new Error(`file not found: ${file}`), { statusCode: 404 })
    }
    if (!st.isFile()) throw Object.assign(new Error('not a file'), { statusCode: 400 })
    json(res, 200, await identify(file))
  })
  router.add('POST', '/api/info/raw', async ({ res, body }) => {
    const file = assertAllowed(String(body.path || ''))
    const level = Math.max(0, Math.min(4, Number(body.verbose ?? 1)))
    const { code, signal, stdout, stderr } = await run(
      'mkvinfo',
      [...Array(level).fill('-v'), file],
      { timeoutMs: 120_000 }
    )
    if (code !== 0 || signal) {
      addLog('warn', 'mkv', `mkvinfo exit=${code}${signal ? ` signal=${signal}` : ''} (verbose=${level})`, `file: ${file}\nstderr: ${stderr}`)
    }
    json(res, 200, { exitCode: code, output: stdout || stderr || (signal ? `killed by ${signal}` : '') })
  })

  // ---------- 章节 ----------
  router.add('GET', '/api/chapters', async ({ res, query }) => {
    const file = assertAllowed(String(query.get('path') || ''))
    if (!fs.existsSync(file)) {
      throw Object.assign(new Error(`file not found: ${file}`), { statusCode: 404 })
    }
    fs.mkdirSync(env.pkgTmp, { recursive: true })
    const tmpXml = path.join(env.pkgTmp, `chapters-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.xml`)
    try {
      // 现行参数序：源文件在前、模式在后（mkvextract 官方文档用法）
      const { code, signal, stdout, stderr } = await run('mkvextract', [file, 'chapters', tmpXml], { timeoutMs: 60_000 })
      if (code !== 0 && !fs.existsSync(tmpXml)) {
        addLog('error', 'mkv', `mkvextract chapters 失败 exit=${code}${signal ? ` signal=${signal}` : ''}`, `file: ${file}\ntmp: ${tmpXml}\nstdout: ${stdout}\nstderr: ${stderr}`)
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n').slice(0, 400)
        throw new Error(`mkvextract chapters failed (exit ${code}${signal ? ` ${signal}` : ''})${detail ? `: ${detail}` : ''}`)
      }
      const xml = fs.existsSync(tmpXml) ? fs.readFileSync(tmpXml, 'utf8') : ''
      json(res, 200, { editions: parseChaptersXml(xml), xml })
    } finally {
      fs.rmSync(tmpXml, { force: true })
    }
  })
  router.add('POST', '/api/chapters/parse', async ({ res, body }) => {
    json(res, 200, { editions: parseChaptersXml(String(body.xml || '')) })
  })
  // 把编辑好的章节 XML 落到临时目录，供后续任务（mkvpropedit --chapters）引用
  router.add('PUT', '/api/chapters/temp', async ({ res, body }) => {
    const xml = buildChaptersXml(body.editions)
    fs.mkdirSync(env.pkgTmp, { recursive: true })
    const file = path.join(env.pkgTmp, `chapters-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.xml`)
    fs.writeFileSync(file, xml)
    json(res, 200, { file, xml })
  })

  // ---------- 字幕编码检测 ----------
  // 批量检测文本字幕的字符集（供内封字幕 --sub-charset 使用）。items: [{ path, hint? }]
  router.add('POST', '/api/subtitles/charset', async ({ res, body }) => {
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : []
    const results = {}
    for (const item of items) {
      const p = typeof item === 'string' ? item : String(item?.path || '')
      const hint = typeof item === 'object' && item ? String(item.hint || '') : ''
      if (!p) continue
      let file = null
      try {
        file = assertAllowed(p)
        if (!fs.statSync(file).isFile()) file = null
      } catch {
        /* 单个文件不存在/越界不拖垮整批 */
      }
      results[p] = file ? detectSubCharset(file, hint) : null
    }
    json(res, 200, { results })
  })

  // ---------- 字幕批量重命名 ----------
  // 批量把字幕改名为匹配视频的文件名。items: [{ from, to }]，overwrite: 目标已存在时是否覆盖。
  // 逐项容错返回每项结果；同批内目标路径互斥，防止前后两项把彼此的成果覆盖掉。
  router.add('POST', '/api/subtitles/rename', async ({ res, body }) => {
    const items = Array.isArray(body.items) ? body.items.slice(0, 500) : []
    const overwrite = !!body.overwrite
    const results = []
    const claimed = new Set()
    for (const item of items) {
      const from = String(item?.from || '')
      const to = String(item?.to || '')
      const r = { from, to, ok: false, error: '' }
      try {
        const src = assertAllowed(from)
        const dst = assertAllowed(to)
        if (src === dst) throw Object.assign(new Error('same path'), { statusCode: 400 })
        if (!fs.statSync(src).isFile()) throw Object.assign(new Error('not a file'), { statusCode: 400 })
        if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) {
          throw Object.assign(new Error('target is a directory'), { statusCode: 400 })
        }
        // 目标已存在：未开覆盖直接拒绝（Linux 的 rename 会静默替换，必须显式拦截）
        if (!overwrite && fs.existsSync(dst)) {
          throw Object.assign(new Error('target exists'), { statusCode: 409 })
        }
        if (claimed.has(dst)) throw Object.assign(new Error('duplicate target in batch'), { statusCode: 409 })
        claimed.add(dst)
        if (overwrite && fs.existsSync(dst)) {
          // 仅大小写不同的场景（Windows/macOS 大小写不敏感盘）指向同一物理文件，先删会把源文件删掉
          if (fs.realpathSync(src) !== fs.realpathSync(dst)) fs.rmSync(dst, { force: true })
        }
        try {
          fs.renameSync(src, dst)
        } catch (err) {
          if (err.code !== 'EXDEV') throw err
          fs.copyFileSync(src, dst)
          fs.rmSync(src, { force: true })
        }
        r.ok = true
      } catch (err) {
        r.error = err.message
      }
      results.push(r)
    }
    json(res, 200, { results })
  })

  // ---------- 运行日志 ----------
  router.add('GET', '/api/logs', async ({ res, query }) => {
    const tail = Math.max(1, Math.min(5000, Number(query.get('tail')) || 1000))
    const level = String(query.get('level') || '')
    const q = String(query.get('q') || '')
    json(res, 200, readLogs({ tail, level, q }))
  })
  // 原始 JSONL 下载（含已轮转的 app.log.1）
  router.add('GET', '/api/logs/raw', async ({ req, res }) => {
    const text = readRawLogs()
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Content-Disposition': 'attachment; filename="app.log"',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(text)
  })
  // 清空：轮转当前日志并重置内存缓冲
  router.add('DELETE', '/api/logs', async ({ res }) => {
    clearLogs()
    addLog('info', 'app', '运行日志已清空（原内容归档为 app.log.1）')
    json(res, 200, { ok: true })
  })

  // ---------- 兼容性占位 ----------
  router.add('GET', '/api/config-defaults', async ({ res }) => {
    json(res, 200, DEFAULT_CONFIG)
  })
}
