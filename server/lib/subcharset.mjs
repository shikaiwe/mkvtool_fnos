// 文本字幕编码检测：内封字幕最常见的问题就是 GBK/Big5 的 SRT 在 Linux 默认按 UTF-8 读取导致乱码，
// 这里用 BOM + 严格解码 + 中文字符计数给出 mkvmerge --sub-charset 可用的编码名。
import fs from 'node:fs'
import path from 'node:path'

// 需要编码处理的纯文本字幕扩展名（.sup/.idx/.pgs 是二进制，无需字符集）
const TEXT_SUB_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'sub', 'vtt', 'smi', 'txt'])

// 采样头部 128KB 足够判断编码
const SAMPLE_SIZE = 128 * 1024

// hint: 'zh-hans' | 'zh-hant' | ''（来自字幕文件名的语言标记，用于 GBK/Big5 优先级）
function candidateCharsets(hint) {
  if (hint === 'zh-hant') return ['BIG5', 'GB18030']
  if (hint === 'zh-hans') return ['GB18030', 'BIG5']
  return ['GB18030', 'BIG5']
}

function strictDecode(buf, enc) {
  try {
    return new TextDecoder(enc, { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

function cjkScore(text) {
  const m = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)
  return m ? m.length : 0
}

// 返回 mkvmerge --sub-charset 可用的编码名；无需/无法处理时返回 null
export function detectSubCharset(file, hint = '') {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!TEXT_SUB_EXTENSIONS.has(ext)) return null

  let buf
  try {
    const fd = fs.openSync(file, 'r')
    try {
      buf = Buffer.alloc(SAMPLE_SIZE)
      const bytes = fs.readSync(fd, buf, 0, SAMPLE_SIZE, 0)
      buf = buf.subarray(0, bytes)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  if (!buf.length) return 'UTF-8'

  // BOM
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'UTF-8'
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'UTF-16LE'
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'UTF-16BE'

  // 合法 UTF-8（无 BOM）直接按 UTF-8
  if (strictDecode(buf, 'utf-8') !== null) return 'UTF-8'

  // 非UTF-8：按候选顺序严格解码；多个候选都能解时用中文字符数打破平局
  //（GBK 文件按 BIG5 严格解码基本必然失败，反之亦然，命中哪个候选通常无歧义）
  const decoded = []
  for (const enc of candidateCharsets(hint)) {
    const text = strictDecode(buf, enc)
    if (text !== null) decoded.push({ enc, score: cjkScore(text) })
  }
  if (decoded.length) {
    decoded.sort((a, b) => b.score - a.score) // 稳定排序：得分相同时保持 hint 优先级
    return decoded[0].enc
  }
  return 'UTF-8'
}
