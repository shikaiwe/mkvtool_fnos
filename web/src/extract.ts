// 提取页共享逻辑：条目状态、输出扩展名推导、mkvextract argv 组装。
import type { Identification, Track } from './api'

export interface ExtractItem {
  path: string
  status: 'identifying' | 'ready' | 'error'
  error: string
  ident: Identification | null
  trackSel: Record<number, boolean>
  trackOut: Record<number, string>
  attachSel: Record<number, boolean>
  tsSel: Record<number, boolean>
  wantChapters: boolean
  chaptersSimple: boolean
  wantTags: boolean
  wantCuesheet: boolean
  wantCues: boolean
}

export function makeItem(path: string): ExtractItem {
  return {
    path,
    status: 'identifying',
    error: '',
    ident: null,
    trackSel: {},
    trackOut: {},
    attachSel: {},
    tsSel: {},
    wantChapters: false,
    chaptersSimple: false,
    wantTags: false,
    wantCuesheet: false,
    wantCues: false,
  }
}

export function baseOf(p: string) {
  return p.split(/[\\/]/).pop() || p
}

export function dirOf(p: string) {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(0, idx) : ''
}

// codec_id 是 Matroska 规范常量（mkvmerge -J 的 properties.codec_id），优先按它定扩展名。
// codec 显示串不可靠：ASS 轨道是 "SubStationAlpha"，按 ass/ssa 匹配不上就会误兜底成 .sub。
const CODEC_ID_EXT: Record<string, string> = {
  'S_TEXT/UTF8': 'srt',
  'S_TEXT/ASS': 'ass',
  'S_TEXT/SSA': 'ssa',
  'S_TEXT/WEBVTT': 'vtt',
  'S_HDMV/PGS': 'sup',
  'S_VOBSUB': 'sub',
  'S_TEXT/CLEARTEXT': 'txt',
}

const CODEC_ID_PREFIX: [string, string][] = [
  ['A_AAC', 'aac'],
  ['A_EAC3', 'eac3'],
  ['A_AC3', 'ac3'],
  ['A_DTS', 'dts'],
  ['A_TRUEHD', 'thd'],
  ['A_MLP', 'thd'],
  ['A_FLAC', 'flac'],
  ['A_OPUS', 'opus'],
  ['A_VORBIS', 'ogg'],
  ['A_MPEG/L3', 'mp3'],
  ['A_PCM', 'wav'],
  ['V_MPEG4/ISO/AVC', 'h264'],
  ['V_MPEGH/ISO/HEVC', 'hevc'],
  ['V_VP8', 'ivf'],
  ['V_VP9', 'ivf'],
  ['V_AV1', 'ivf'],
  ['V_MPEG1', 'm2v'],
  ['V_MPEG2', 'm2v'],
]

const CODEC_EXT: [RegExp, string][] = [
  [/aac/i, 'aac'],
  [/mp3|mpegh/i, 'mp3'],
  [/flac/i, 'flac'],
  [/opus/i, 'opus'],
  [/vorbis/i, 'ogg'],
  [/ac-?3|e-?ac-?3/i, 'ac3'],
  [/dts/i, 'dts'],
  [/truehd|thd/i, 'thd'],
  [/pcm/i, 'wav'],
  [/avc|h\.?264/i, 'h264'],
  [/hevc|h\.?265/i, 'hevc'],
  [/vp8|vp9|av1/i, 'ivf'],
  [/mpeg-?1|mpeg-?2/i, 'm2v'],
  [/subrip|srt/i, 'srt'],
  [/substation|ass|ssa/i, 'ass'],
  [/pgs|hdmv/i, 'sup'],
  [/vobsub|subrip? bitmap/i, 'sub'],
  [/webvtt/i, 'vtt'],
  [/utf-?8|txt/i, 'txt'],
]

export function defaultExt(tr: Track) {
  const cid = String(tr.properties?.codec_id || '').toUpperCase()
  if (CODEC_ID_EXT[cid]) return CODEC_ID_EXT[cid]
  for (const [pfx, ext] of CODEC_ID_PREFIX) if (cid.startsWith(pfx)) return ext
  for (const [re, ext] of CODEC_EXT) if (re.test(tr.codec || '')) return ext
  return tr.type === 'subtitles' ? 'sub' : tr.type === 'video' ? 'mkv' : 'bin'
}

// 输出目录：全局 outDir 优先（用户显式指定/设置页默认），留空则与该源文件同目录
export function effectiveDir(item: ExtractItem, outDir: string) {
  return (outDir || dirOf(item.path)).replace(/[\\/]+$/, '')
}

// 现行参数序：源文件在最前，其后依次为各模式与提取规格（mkvextract 官方文档用法）。
// 章节等共享型输出带源文件名前缀，批量输出到同一目录时互不覆盖。
export function buildArgv(item: ExtractItem, outDir: string): string[] | null {
  if (item.status !== 'ready' || !item.ident) return null
  const base = baseOf(item.path).replace(/\.[^.]+$/, '')
  const out = (name: string) => effectiveDir(item, outDir) + '/' + name
  const args: string[] = [item.path]
  const tracks = (item.ident.tracks || []).filter((tr) => item.trackSel[tr.id])
  if (tracks.length) {
    args.push('tracks')
    for (const tr of tracks) args.push(`${tr.id}:${out(item.trackOut[tr.id] || `${base}.track${tr.id}.bin`)}`)
  }
  const ts = (item.ident.tracks || []).filter((tr) => item.tsSel[tr.id])
  if (ts.length) {
    args.push('timestamps_v2')
    for (const tr of ts) args.push(`${tr.id}:${out(`${base}.track${tr.id}.timestamps.txt`)}`)
  }
  const atts = (item.ident.attachments || []).filter((a) => item.attachSel[a.id])
  if (atts.length) {
    args.push('attachments')
    for (const a of atts) args.push(`${a.id}:${out(a.name || `${base}.attachment_${a.id}`)}`)
  }
  if (item.wantChapters) args.push('chapters', ...(item.chaptersSimple ? ['-s'] : []), out(`${base}.chapters.xml`))
  if (item.wantTags) args.push('tags', out(`${base}.tags.xml`))
  if (item.wantCuesheet) args.push('cuesheet', out(`${base}.cuesheet.cue`))
  if (item.wantCues) args.push('cues', out(`${base}.cues.cue`))
  return args.length > 1 ? args : null
}
