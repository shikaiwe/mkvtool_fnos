// 内封字幕工具：语言猜测、轨道名、输出文件名推导、视频-字幕批量配对、mkvmerge 参数拼装
import type { FileEntry } from './api'

export const VIDEO_EXTENSIONS = new Set([
  'mkv', 'mks', 'mk3d', 'webm',
  'mp4', 'm4v', 'mov', 'ts', 'm2ts', 'mts', 'avi', 'flv', 'ogv',
])
export const SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'sub', 'sup', 'vtt', 'idx', 'smi'])
// 需要字符集处理的文本字幕（.sup/.idx 为二进制形态无需处理）
export const TEXT_SUBTITLE_EXTENSIONS = new Set(['srt', 'ass', 'ssa', 'sub', 'vtt', 'smi'])
// 外挂音频（无损/常见几种）：mka 是纯音频容器（原误列为视频输入），一并按文件名与视频配对
export const AUDIO_EXTENSIONS = new Set(['mka', 'flac', 'ac3', 'eac3', 'dts', 'dtshd', 'truehd', 'thd', 'aac'])

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

// 外挂音轨行：无字符集/强制，改为评论轨标记
export interface AudioRow {
  path: string
  fileName: string
  lang: string
  trackName: string
  isDefault: boolean
  isCommentary: boolean
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

// 一个视频匹配到多个字幕、改名后目标同名时的区分后缀：
// 取字幕名去扩展名后、位于视频配对键之后、且非语言标记的描述性 token（如发布组风格的 CASO.subset、
// Hitagi&Suruga.CM.subset），用 . 连接。描述 token 与视频完全一致（仅语言标记不同）时退回语言标记。
export function distinguishingSuffix(videoName: string, subName: string): string {
  const vKey = pairingKey(videoName)
  const vTokens = vKey ? vKey.split(' ') : []
  const ext = extOf(subName)
  const base = ext ? subName.slice(0, subName.length - ext.length - 1) : subName
  const descriptors = base.split(/[._\- [\]()]+/).filter(Boolean).filter((tok) => !matchLangToken(tok))
  let i = 0
  while (i < descriptors.length && i < vTokens.length && descriptors[i].toLowerCase() === vTokens[i]) i++
  const rem = descriptors.slice(i).join('.')
  return rem || langTokenOf(subName)
}

export interface PairRow {
  video: FileEntry
  subs: FileEntry[]
  audios: FileEntry[]
  outName: string
}

export interface PairResult {
  rows: PairRow[]
  unmatchedVideos: FileEntry[]
  unmatchedSubs: FileEntry[]
  unmatchedAudios: FileEntry[]
}

// 前缀必须止于词边界（"s01e01" 不能匹配 "s01e010"，但能匹配 "s01e01 fix"）
function isTokenPrefix(prefix: string, full: string): boolean {
  if (prefix === full) return false
  if (!full.startsWith(prefix)) return false
  const rest = full.slice(prefix.length)
  return /^[\s_-]/.test(rest)
}

// ---------- 模糊匹配（第三轮）----------
// 发布组风格命名（[Group] Title [EP][Quality][Codec]...）里，视频与字幕常因发布组、质量、
// 编码、额外描述词不同而「配对键」完全不同，前两轮（精确/前缀）都匹配不到。此轮改以
// 「集数 + 标题核心词」为信号：集数一致（且共享 ≥1 个核心词）即配对；任一侧缺集数时要求
// 共享 ≥2 个核心词，避免把同集数的不同作品误配到一起。规格/来源/编码/厂牌等噪声词会从
// 核心词中剔除，让标题真正主导匹配（跨发布组、跨质量、跨编码的同一集也能配到一起）。

// 低区分度噪声词：分辨率 / 画幅、视频编码、音频、来源、位深、厂牌修饰。
// 同名词在不同发布组间高频出现，剔除后不会把「共享这些词」误判为同一作品。
const META_TOKENS = new Set([
  '240p', '360p', '480p', '540p', '576p', '720p', '810p', '816p', '1080p', '1440p', '2160p',
  '480', '720', '1080', '1440', '2160', '4k', 'uhd', 'hd', 'fhd', 'xga', 'hqa', 'qfhd',
  'x264', 'x265', 'hevc', 'h264', 'h265', 'avc', 'av1', 'vp9', 'vp8', 'divx', 'xvid', 'mpeg2', 'mpeg4',
  'aac', 'ac3', 'eac3', 'flac', 'dts', 'dtshd', 'truehd', 'opus', 'mp3', 'vorbis', 'atmos', 'dolby', 'lpcm', 'wma',
  'bdrip', 'brrip', 'blu', 'ray', 'bd', 'hdtv', 'hdrip', 'uhdrip', 'uhdbrip', 'webrip', 'webdl', 'web', 'dl', 'dvdrip', 'dvdr', 'hdcam', 'cam', 'remux', 'rip', 'hq', 'lq', 'fix', 'clean', 'recut', 'repack',
  '10bit', '8bit', '10b', '8b',
  'studio', 'studios', 'anime', 'anim', 'group', 'release', 'batch', 'complete', 'full', 'all', 'series', 'special', 'pack', 'season', 'episode', 'vol', 'volume', 'uncut', 'cut', 'limited', 'final', 'proper', 'popular', 'cinematic', 'ova', 'on', 'the', 'of', 'and', 'sub', 'subbed', 'dub', 'dubbed',
])

// zh-Hans / zh-Hant 被切词拆成 zh+hans 后，hans/hant 不在语言规则表内，单独剔除
const LANG_ALIAS = new Set(['hans', 'hant'])

// 归一化集数：把 01 / e01 / ep01 / s01e02 / part1 / 第1集 / 1话 等统一成数字，
// 让不同写法的同一集可被识别为相同（视频 [01] 与字幕 E01 不因此失配）；识别不到返回 null
export function episodeOf(name: string): number | null {
  const ext = extOf(name)
  const base = ext ? name.slice(0, name.length - ext.length - 1) : name
  const tokens = base.split(/[._\- [\]()]+/).filter(Boolean).map((t) => t.toLowerCase())
  const twoTokenMarker = /^(ep|episode|e|s)$/
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    let m = t.match(/^第?(\d{1,3})[集话回話]$/)
    if (m) return +m[1]
    m = t.match(/^episode(\d{1,3})$/) || t.match(/^ep(\d{1,3})$/)
    if (m) return +m[1]
    m = t.match(/^e(\d{1,3})$/)
    if (m) return +m[1]
    m = t.match(/^s(\d{1,2})e(\d{1,3})$/)
    if (m) return +m[2]
    m = t.match(/^part(\d{1,3})$/)
    if (m) return +m[1]
    if (/^\d{1,3}$/.test(t)) return +t
    if (i + 1 < tokens.length && twoTokenMarker.test(t) && /^\d{1,3}$/.test(tokens[i + 1])) return +tokens[i + 1]
  }
  return null
}

// 标题核心词：切词后剔除 语言标记 / 语言别名 / 规格噪声 / 纯数字 / 单个拉丁字母，
// 剩下的（多为标题词、发布组、描述词）构成「核心词」集合，是模糊匹配的信号来源
export function coreWords(name: string): Set<string> {
  const ext = extOf(name)
  const base = ext ? name.slice(0, name.length - ext.length - 1) : name
  const set = new Set<string>()
  for (const raw of base.split(/[._\- [\]()]+/).filter(Boolean)) {
    const t = raw.toLowerCase()
    if (matchLangToken(t)) continue
    if (LANG_ALIAS.has(t)) continue
    if (META_TOKENS.has(t)) continue
    if (/^\d+$/.test(t)) continue
    if (/^[a-z]$/.test(t)) continue
    set.add(t)
  }
  return set
}

// 两个文件名的模糊相似度（0~1）：集数不同直接 0；集数一致要求共享 ≥1 核心词，
// 缺集数要求共享 ≥2 核心词；共享越多分越高（用于在多个视频间择优）
export function fuzzyPairScore(videoName: string, subName: string): number {
  return fuzzyCoreScore(episodeOf(videoName), coreWords(videoName), episodeOf(subName), coreWords(subName))
}

function fuzzyCoreScore(ge: number | null, gw: Set<string>, ve: number | null, vw: Set<string>): number {
  if (ge != null && ve != null && ge !== ve) return 0
  let inter = 0
  for (const w of gw) if (vw.has(w)) inter++
  const cov = inter / (Math.min(gw.size, vw.size) || 1)
  const need = ge != null && ve != null ? 1 : 2
  if (inter < need) return 0
  return 0.5 + 0.5 * cov
}

// 把外挂文件按配对键分组
function groupByKey(files: FileEntry[]): Map<string, FileEntry[]> {
  const map = new Map<string, FileEntry[]>()
  for (const f of files) {
    const k = pairingKey(f.name)
    const list = map.get(k) || []
    list.push(f)
    map.set(k, list)
  }
  return map
}

// 把一批外挂文件组配到视频：
// 1) 先精确 key 匹配；2) 再按视频 key 从长到短（最具体优先）遍历所有视频，
// 吸纳所有未被占用、且与视频 key 互为词边界前缀的组（一个视频可收多组，修复"两个字幕只显示一个"）；
// 3) 最后模糊匹配：以字幕组为中心，为每个未占用组挑选「集数+标题核心词」相似度最高的视频，
// 处理发布组/质量/编码命名风格不同但同一集数的情况（一个视频仍可收多组）。
function assignGroups(
  videos: FileEntry[],
  groups: Map<string, FileEntry[]>
): { byVideo: Map<string, FileEntry[]>; consumed: Set<string> } {
  const byVideo = new Map<string, FileEntry[]>()
  const consumed = new Set<string>()
  const add = (v: FileEntry, key: string) => {
    const list = byVideo.get(v.path) || []
    list.push(...groups.get(key)!)
    byVideo.set(v.path, list)
    consumed.add(key)
  }

  for (const v of videos) {
    const key = pairingKey(v.name)
    if (groups.has(key) && !consumed.has(key)) add(v, key)
  }
  const byLenDesc = [...videos].sort((a, b) => pairingKey(b.name).length - pairingKey(a.name).length)
  for (const v of byLenDesc) {
    const key = pairingKey(v.name)
    for (const k of groups.keys()) {
      if (consumed.has(k)) continue
      if (isTokenPrefix(key, k) || isTokenPrefix(k, key)) add(v, k)
    }
  }
  // 第三轮（模糊）：发布组/质量/编码等命名风格不同、但同一集数的配对。
  // 以字幕组为中心，为每个未占用组挑选相似度最高的视频（组内同键 → 取首文件的集数/核心词即可）。
  const videoMeta = videos.map((v) => ({ v, ep: episodeOf(v.name), words: coreWords(v.name) }))
  for (const k of [...groups.keys()]) {
    if (consumed.has(k)) continue
    const gfiles = groups.get(k)!
    if (!gfiles.length) continue
    const gEp = episodeOf(gfiles[0].name)
    const gWords = coreWords(gfiles[0].name)
    let best: FileEntry | null = null
    let bestScore = 0
    for (const vm of videoMeta) {
      const sc = fuzzyCoreScore(gEp, gWords, vm.ep, vm.words)
      if (sc > bestScore) {
        bestScore = sc
        best = vm.v
      }
    }
    if (best && bestScore >= 0.5) add(best, k)
  }
  for (const list of byVideo.values()) {
    list.sort((a, b) => subSortScore(a.name) - subSortScore(b.name) || a.name.localeCompare(b.name))
  }
  return { byVideo, consumed }
}

export function pairVideos(
  videos: FileEntry[],
  subs: FileEntry[],
  suffix = '.subs',
  audios: FileEntry[] = []
): PairResult {
  // VobSub 成对文件（.idx+.sub）：存在 .idx 时剔除同键的 .sub（二进制伴生文件，不能混入）
  const idxKeys = new Set(subs.filter((s) => extOf(s.name) === 'idx').map((s) => pairingKey(s.name)))
  const usableSubs = subs.filter((s) => extOf(s.name) !== 'sub' || !idxKeys.has(pairingKey(s.name)))

  const subGroups = groupByKey(usableSubs)
  const audioGroups = groupByKey(audios)
  const subAssign = assignGroups(videos, subGroups)
  const audioAssign = assignGroups(videos, audioGroups)

  const rows: PairRow[] = []
  const unmatchedVideos: FileEntry[] = []
  for (const v of videos) {
    const s = subAssign.byVideo.get(v.path) || []
    const a = audioAssign.byVideo.get(v.path) || []
    if (s.length || a.length) {
      rows.push({ video: v, subs: s, audios: a, outName: defaultOutputFor(v.path, suffix).name })
    } else {
      unmatchedVideos.push(v)
    }
  }
  rows.sort((a, b) => a.video.path.localeCompare(b.video.path))
  const unmatchedSubs = usableSubs.filter((s) => !subAssign.consumed.has(pairingKey(s.name)))
  const unmatchedAudios = audios.filter((a) => !audioAssign.consumed.has(pairingKey(a.name)))
  return { rows, unmatchedVideos, unmatchedSubs, unmatchedAudios }
}

// ---------- mkvmerge 参数 ----------

export interface SubMuxOptions {
  outPath: string
  videoPath: string
  dropEmbeddedSubs: boolean
  segTitle?: string
  subs: SubRow[]
  audios?: AudioRow[]
  dropEmbeddedAudio?: boolean
}

// 拼装内封字幕/音频的 mkvmerge 参数（不含工具名）。轨道选项作用于其后的文件；外挂字幕/音频都是单轨文件，TID=0。
export function buildSubMuxArgv(o: SubMuxOptions): string[] {
  const args: string[] = ['--output', o.outPath]
  if (o.segTitle) args.push('--title', o.segTitle)
  if (o.dropEmbeddedSubs) args.push('--no-subtitles')
  if (o.dropEmbeddedAudio) args.push('--no-audio')
  args.push(o.videoPath)
  for (const s of o.subs) {
    if (s.charset) args.push('--sub-charset', `0:${s.charset}`)
    if (s.lang) args.push('--language', `0:${s.lang}`)
    if (s.trackName) args.push('--track-name', `0:${s.trackName}`)
    args.push('--default-track-flag', `0:${s.isDefault ? 1 : 0}`)
    if (s.isForced) args.push('--forced-display-flag', '0:1')
    args.push(s.path)
  }
  for (const a of o.audios || []) {
    if (a.lang) args.push('--language', `0:${a.lang}`)
    if (a.trackName) args.push('--track-name', `0:${a.trackName}`)
    args.push('--default-track-flag', `0:${a.isDefault ? 1 : 0}`)
    if (a.isCommentary) args.push('--commentary-flag', '0:1')
    args.push(a.path)
  }
  return args
}
