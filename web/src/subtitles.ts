// 内封字幕工具：语言猜测、轨道名、输出文件名推导、视频-字幕批量配对、mkvmerge 参数拼装
import type { FileEntry } from './api'

export const VIDEO_EXTENSIONS = new Set([
  'mkv', 'mka', 'mks', 'mk3d', 'webm',
  'mp4', 'm4v', 'mov', 'ts', 'm2ts', 'mts', 'avi', 'flv', 'ogv',
])
export const SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'sub', 'sup', 'vtt', 'idx', 'smi'])
// 需要字符集处理的文本字幕（.sup/.idx 为二进制形态无需处理）
export const TEXT_SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'sub', 'vtt', 'smi'])

export interface LangGuess {
  lang: string
  name: string
  hint: '' | 'zh-hans' | 'zh-hant' | 'ja'
}

// 文件名语言标记（按 token 全等匹配，token 按 . _ - 空格 等切分）
const LANG_TAG_MATCHERS: { re: RegExp; guess: LangGuess }[] = [
  { re: /^(简体|簡體|简|簡|chs|sc|gb|zhs|zhhans|zh-hans)$/i, guess: { lang: 'chi', name: '简体中文', hint: 'zh-hans' } },
  { re: /^(繁体|繁體|繁|cht|tc|big5|b5|zht|zhhant|zh-hant|tw|hk)$/i, guess: { lang: 'chi', name: '繁體中文', hint: 'zh-hant' } },
  { re: /^(zh|zho|chi|chinese|cn)$/i, guess: { lang: 'chi', name: '中文', hint: 'zh-hans' } },
  { re: /^(eng|en|english)$/i, guess: { lang: 'eng', name: 'English', hint: '' } },
  { re: /^(jpn|jp|ja|japanese)$/i, guess: { lang: 'jpn', name: '日本語', hint: 'ja' } },
  { re: /^(kor|kr|ko|korean)$/i, guess: { lang: 'kor', name: '한국어', hint: '' } },
  { re: /^(fre|fra|fr|french)$/i, guess: { lang: 'fre', name: 'Français', hint: '' } },
  { re: /^(ger|deu|de|german)$/i, guess: { lang: 'ger', name: 'Deutsch', hint: '' } },
  { re: /^(spa|es|spanish)$/i, guess: { lang: 'spa', name: 'Español', hint: '' } },
  { re: /^(por|pt|portuguese)$/i, guess: { lang: 'por', name: 'Português', hint: '' } },
  { re: /^(ita|it|italian)$/i, guess: { lang: 'ita', name: 'Italiano', hint: '' } },
  { re: /^(rus|ru|russian)$/i, guess: { lang: 'rus', name: 'Русский', hint: '' } },
  { re: /^(tha|th|thai)$/i, guess: { lang: 'tha', name: 'ไทย', hint: '' } },
]

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

// 单个 token 的语言匹配：
// 1) 复合标记（chs&eng）按规则表顺序优先命中——结果与书写顺序无关（jp&sc 与 sc&jp 同为简体中文）；
// 2) 连写组合（JPSC = jp+sc）拆成两段，两段都命中某条规则才认，取规则表更靠前（中文优先）的那个。
export function matchLangToken(token: string): LangGuess | null {
  const t = token.toLowerCase()
  const parts = t.split(/[&+]/)
  for (const m of LANG_TAG_MATCHERS) {
    for (const p of parts) {
      if (m.re.test(p)) return m.guess
    }
  }
  if (parts.length === 1 && t.length >= 2) {
    for (let i = 1; i < t.length; i++) {
      const h = LANG_TAG_MATCHERS.findIndex((m) => m.re.test(t.slice(0, i)))
      const g = LANG_TAG_MATCHERS.findIndex((m) => m.re.test(t.slice(i)))
      if (h < 0 || g < 0) continue
      return (h <= g ? LANG_TAG_MATCHERS[h] : LANG_TAG_MATCHERS[g]).guess
    }
  }
  return null
}

// 从文件名猜字幕语言：从文件名末段往前找语言标记（如 Movie.chs.ass → 简体中文）
export function guessLanguage(fileName: string): LangGuess | null {
  const ext = extOf(fileName)
  const base = ext ? fileName.slice(0, fileName.length - ext.length - 1) : fileName
  const tokens = base.split(/[._\- [\]()]+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const g = matchLangToken(tokens[i])
    if (g) return g
  }
  return null
}

// 找到文件名中的语言标记 token 并原样返回（如 chs、CHT&ENG、连写 jpsc），找不到返回 ''（改名时保留语言后缀用）
export function langTokenOf(fileName: string): string {
  const ext = extOf(fileName)
  const base = ext ? fileName.slice(0, fileName.length - ext.length - 1) : fileName
  const tokens = base.split(/[._\- [\]()]+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (matchLangToken(tokens[i])) return tokens[i]
  }
  return ''
}

// 语言下拉框候选（沿用高级模式的常用语言）
export const SUB_LANG_PRESETS = ['chi', 'zho', 'eng', 'jpn', 'kor', 'fre', 'ger', 'spa', 'rus', 'tha', 'por', 'ita', 'und']

// 字幕改名“添加语言后缀”候选：取自上面的语言识别规则表，每个后缀都能被 matchLangToken 识别
//（含 jp+sc 连写组合），改出的文件名可被本工具与播放器按名识别
export const LANG_SUFFIX_PRESETS: { suffix: string; name: string }[] = [
  { suffix: 'sc', name: '简体中文' },
  { suffix: 'tc', name: '繁體中文' },
  { suffix: 'jpsc', name: '日本語+简体中文' },
  { suffix: 'jptc', name: '日本語+繁體中文' },
  { suffix: 'jp', name: '日本語' },
  { suffix: 'en', name: 'English' },
  { suffix: 'ko', name: '한국어' },
  { suffix: 'fr', name: 'Français' },
  { suffix: 'de', name: 'Deutsch' },
  { suffix: 'es', name: 'Español' },
  { suffix: 'pt', name: 'Português' },
  { suffix: 'it', name: 'Italiano' },
  { suffix: 'ru', name: 'Русский' },
  { suffix: 'th', name: 'ไทย' },
]

// 字符集下拉候选（快速/批量内封共用；后端自动检测仅覆盖 UTF-8 与 GB18030/BIG5/日文系）
export const SUB_CHARSETS = ['UTF-8', 'GB18030', 'BIG5', 'UTF-16LE', 'UTF-16BE', 'SHIFT_JIS', 'EUC-JP', 'EUC-KR', 'WINDOWS-1252']

// 字幕行在列表中的默认排序：简中 > 繁中 > 英文 > 其余按名称
export function subSortScore(fileName: string): number {
  const g = guessLanguage(fileName)
  if (!g) return 3
  if (g.hint === 'zh-hans') return 0
  if (g.lang === 'chi') return 1
  if (g.lang === 'eng') return 2
  return 3
}

export interface SubRow {
  path: string
  fileName: string
  lang: string
  trackName: string
  isDefault: boolean
  isForced: boolean
  charset: string // '' = 不指定
}

export function guessTrackName(fileName: string): string {
  return guessLanguage(fileName)?.name || ''
}

// 输出文件推导：与视频同目录；视频本身是 mkv 时加后缀避免覆盖源文件
export function defaultOutputFor(videoPath: string, suffix = '.subs'): { dir: string; name: string } {
  const idx = Math.max(videoPath.lastIndexOf('/'), videoPath.lastIndexOf('\\'))
  const dir = idx >= 0 ? videoPath.slice(0, idx) : ''
  const name = idx >= 0 ? videoPath.slice(idx + 1) : videoPath
  const ext = extOf(name)
  const base = ext ? name.slice(0, name.length - ext.length - 1) : name
  const needSuffix = ext === 'mkv' || ext === 'mks' || ext === 'mk3d'
  return { dir, name: base + (needSuffix ? suffix : '') + '.mkv' }
}

export function joinPath(dir: string, name: string): string {
  return (dir.replace(/[\\/]+$/, '') + '/' + name.replace(/^[\\/]+/, '')).replace(/^\/+/, '/')
}

// ---------- 批量配对 ----------

// 配对键：去掉扩展名与语言标记后的小写串（S01E01.chs.ass 与 S01E01.mkv 归为一组；
// 连写组合如 jpsc 同样视为语言标记剔除）
export function pairingKey(fileName: string): string {
  const ext = extOf(fileName)
  const base = ext ? fileName.slice(0, fileName.length - ext.length - 1) : fileName
  const tokens = base.split(/[._\- [\]()]+/).filter(Boolean)
  const kept = tokens.filter((tok) => !matchLangToken(tok))
  return kept.join(' ').toLowerCase()
}

export interface PairRow {
  video: FileEntry
  subs: FileEntry[]
  outName: string
}

export interface PairResult {
  rows: PairRow[]
  unmatchedVideos: FileEntry[]
  unmatchedSubs: FileEntry[]
}

// 前缀必须止于词边界（"s01e01" 不能匹配 "s01e010"，但能匹配 "s01e01 fix"）
function isTokenPrefix(prefix: string, full: string): boolean {
  if (prefix === full) return false
  if (!full.startsWith(prefix)) return false
  const rest = full.slice(prefix.length)
  return /^[\s_-]/.test(rest)
}

export function pairVideos(videos: FileEntry[], subs: FileEntry[], suffix = '.subs'): PairResult {
  // VobSub 成对文件（.idx+.sub）：存在 .idx 时剔除同键的 .sub（二进制伴生文件，不能混入）
  const idxKeys = new Set(subs.filter((s) => extOf(s.name) === 'idx').map((s) => pairingKey(s.name)))
  const usableSubs = subs.filter((s) => extOf(s.name) !== 'sub' || !idxKeys.has(pairingKey(s.name)))

  const subMap = new Map<string, FileEntry[]>()
  for (const s of usableSubs) {
    const k = pairingKey(s.name)
    const list = subMap.get(k) || []
    list.push(s)
    subMap.set(k, list)
  }
  for (const list of subMap.values()) {
    list.sort((a, b) => subSortScore(a.name) - subSortScore(b.name) || a.name.localeCompare(b.name))
  }

  const rows: PairRow[] = []
  const unmatchedVideos: FileEntry[] = []
  const matchedVideos = new Set<string>()
  const consumedKeys = new Set<string>()

  const take = (v: FileEntry, key: string) => {
    matchedVideos.add(v.path)
    consumedKeys.add(key)
    rows.push({ video: v, subs: subMap.get(key)!, outName: defaultOutputFor(v.path, suffix).name })
  }

  // 两轮配对：先精确匹配，再词边界前缀匹配（视频带发布组/分辨率标签而字幕被重命名干净的场景）
  for (const v of videos) {
    const key = pairingKey(v.name)
    if (subMap.has(key) && !consumedKeys.has(key)) take(v, key)
  }
  for (const v of videos) {
    if (matchedVideos.has(v.path)) continue
    const key = pairingKey(v.name)
    let best: string | null = null
    let bestDiff = Infinity
    for (const k of subMap.keys()) {
      if (consumedKeys.has(k)) continue
      if (!isTokenPrefix(key, k) && !isTokenPrefix(k, key)) continue
      const diff = Math.abs(k.length - key.length)
      if (diff < bestDiff) {
        bestDiff = diff
        best = k
      }
    }
    if (best) take(v, best)
    else unmatchedVideos.push(v)
  }
  rows.sort((a, b) => a.video.path.localeCompare(b.video.path))
  const unmatchedSubs = usableSubs.filter((s) => !consumedKeys.has(pairingKey(s.name)))
  return { rows, unmatchedVideos, unmatchedSubs }
}

// ---------- mkvmerge 参数 ----------

export interface SubMuxOptions {
  outPath: string
  videoPath: string
  dropEmbeddedSubs: boolean
  segTitle?: string
  subs: SubRow[]
}

// 拼装内封字幕的 mkvmerge 参数（不含工具名）。轨道选项作用于其后的文件；外挂字幕都是单轨文件，TID=0。
export function buildSubMuxArgv(o: SubMuxOptions): string[] {
  const args: string[] = ['--output', o.outPath]
  if (o.segTitle) args.push('--title', o.segTitle)
  if (o.dropEmbeddedSubs) args.push('--no-subtitles')
  args.push(o.videoPath)
  for (const s of o.subs) {
    if (s.charset) args.push('--sub-charset', `0:${s.charset}`)
    if (s.lang) args.push('--language', `0:${s.lang}`)
    if (s.trackName) args.push('--track-name', `0:${s.trackName}`)
    args.push('--default-track-flag', `0:${s.isDefault ? 1 : 0}`)
    if (s.isForced) args.push('--forced-display-flag', '0:1')
    args.push(s.path)
  }
  return args
}
