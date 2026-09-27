<script setup lang="ts">
// 高级混流：完整轨道编辑 + mkvmerge 参数拼装（常规内封字幕请用 QuickSubMux / BatchSubMux）
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NInputNumber, NSelect, NCheckbox, NSwitch, NTag,
  NGrid, NGi, NDivider, NTable, NAlert, NPopconfirm, useMessage,
} from 'naive-ui'
import { api, tokenizeArgs, type Identification } from '../api'
import FileBrowser from '../components/FileBrowser.vue'
import {
  defaultOutputFor, extOf, guessLanguage, SUB_CHARSETS,
  SUBTITLE_EXTENSIONS, TEXT_SUBTITLE_EXTENSIONS,
} from '../subtitles'

const { t } = useI18n()
const message = useMessage()

interface UITrack {
  id: number
  type: string
  codec: string
  enabled: boolean
  name: string
  lang: string
  isDefault: boolean
  isForced: boolean
  isCommentary: boolean
  delay: number | null
  charset: string // 仅外挂文本字幕源有意义，'' = 不指定
}
interface Source {
  path: string
  isExternalSub: boolean
  loading: boolean
  error: string
  ident: Identification | null
  keepChapters: boolean
  tracks: UITrack[]
}

const outDir = ref('')
const outName = ref('')
const segTitle = ref('')
const sources = ref<Source[]>([])
const splitMode = ref<'none' | 'duration' | 'size' | 'timestamps'>('none')
const splitValue = ref('')
const chaptersFile = ref('')
const attachments = ref<{ path: string; name: string }[]>([])
const extraArgs = ref('')

const browser = ref(false)
const browserMode = ref<'file' | 'dir'>('file')
let browserTarget: 'outDir' | 'chapters' | `src` | `attach` | null = null
let activeSourceIndex = -1

const langOptions = (current: string) => [
  current,
  'und',
  'chi',
  'zho',
  'eng',
  'jpn',
  'kor',
  'fre',
  'ger',
  'spa',
  'rus',
  'tha',
]
  .filter((v, i, a) => v && a.indexOf(v) === i)
  .map((v) => ({ label: v, value: v }))

const charsetOptions = (current: string) =>
  [...new Set([current, ...SUB_CHARSETS])].filter(Boolean).map((v) => ({ label: v, value: v }))

function openBrowser(mode: 'file' | 'dir', target: typeof browserTarget, index = -1) {
  browserMode.value = mode
  browserTarget = target
  activeSourceIndex = index
  browser.value = true
}

function identifyTrackProperties(
  props: Record<string, any>
): Pick<UITrack, 'name' | 'lang' | 'isDefault' | 'isForced' | 'isCommentary'> {
  return {
    name: props.track_name || '',
    lang: props.language || props.language_ietf || 'und',
    isDefault: !!props.default_track,
    isForced: !!props.forced_track,
    isCommentary: !!props.commentary_track,
  }
}

function onBrowserSelect(p: string) {
  const target = browserTarget
  browserTarget = null
  if (!target) return
  if (target === 'outDir') outDir.value = p
  else if (target === 'chapters') chaptersFile.value = p
  else if (target === 'attach') addAttachments([p])
  else if (target === 'src') addSources([p])
}

function onBrowserSelectMulti(paths: string[]) {
  const target = browserTarget
  browserTarget = null
  if (!target) return
  if (target === 'src') addSources(paths)
  else if (target === 'attach') addAttachments(paths)
}

function addAttachments(paths: string[]) {
  for (const p of paths) attachments.value.push({ path: p, name: p.split(/[\\/]/).pop() || '' })
}

function mkSource(p: string): Source {
  return {
    path: p,
    isExternalSub: SUBTITLE_EXTENSIONS.has(extOf(p)),
    loading: true,
    error: '',
    ident: null,
    keepChapters: true,
    tracks: [],
  }
}

async function addSources(paths: string[]) {
  const existing = new Set(sources.value.map((s) => s.path))
  const fresh = paths.filter((p) => !existing.has(p))
  if (!fresh.length) return
  // 输出目录自动填写：新任务的第一个输入文件所在目录（与快速内封一致）
  if (sources.value.length === 0 || !outDir.value) {
    outDir.value = defaultOutputFor(fresh[0]).dir
  }
  for (const p of fresh) {
    sources.value.push(mkSource(p))
  }
  // 之后一切赋值都要走 sources.value 里的响应式代理，改 raw 对象不会触发更新
  const rows = sources.value.slice(sources.value.length - fresh.length)
  await Promise.all(rows.map((row) => identifySource(row)))
  await detectSubCharsets(rows)
}

async function identifySource(row: Source) {
  try {
    row.ident = await api.identify(row.path)
    row.tracks = row.ident.tracks.map((tr) => ({
      id: tr.id,
      type: tr.type,
      codec: tr.codec,
      enabled: true,
      ...identifyTrackProperties(tr.properties),
      delay: null,
      charset: '',
    }))
    // 外挂字幕源 mkvmerge -J 只报 und/空名，语言与轨道名按文件名规则猜（与快速内封一致）
    if (row.isExternalSub) {
      const g = guessLanguage(row.path.split(/[\\/]/).pop() || row.path)
      if (g) {
        for (const tr of row.tracks) {
          if (tr.type === 'subtitles') {
            tr.lang = g.lang
            tr.name = g.name
          }
        }
      }
    }
  } catch (e: any) {
    row.error = e.message
  } finally {
    row.loading = false
  }
}

// 外挂文本字幕批量字符集检测（GBK/Big5 等防乱码），已有字符集的不覆盖
async function detectSubCharsets(rows: Source[]) {
  const targets: { row: Source; tr: UITrack }[] = []
  for (const row of rows) {
    if (!TEXT_SUBTITLE_EXTENSIONS.has(extOf(row.path))) continue
    for (const tr of row.tracks) {
      if (tr.type === 'subtitles' && !tr.charset) targets.push({ row, tr })
    }
  }
  if (!targets.length) return
  try {
    const items = targets.map(({ row }) => ({
      path: row.path,
      hint: guessLanguage(row.path.split(/[\\/]/).pop() || row.path)?.hint || '',
    }))
    const { results } = await api.detectCharsets(items)
    for (const { row, tr } of targets) {
      const cs = results[row.path]
      if (cs) tr.charset = cs
    }
  } catch {
    /* 检测失败则不指定字符集 */
  }
}

function removeSource(i: number) {
  sources.value.splice(i, 1)
}

function joinPath(dir: string, name: string) {
  return (dir.replace(/[\\/]+$/, '') + '/' + name.replace(/^[\\/]+/, '')).replace(/^\/+/, '/')
}

const argv = computed<string[]>(() => {
  const args: string[] = ['mkvmerge', '--output', joinPath(outDir.value, outName.value || 'output.mkv')]
  if (segTitle.value) args.push('--title', segTitle.value)

  for (const src of sources.value) {
    if (!src.ident) {
      args.push(src.path)
      continue
    }
    for (const type of ['video', 'audio', 'subtitles']) {
      const all = src.tracks.filter((x) => x.type === type)
      const on = all.filter((x) => x.enabled)
      if (!all.length) continue
      if (!on.length) args.push(`--no-${type}`)
      else if (on.length < all.length) args.push(`--${type}-tracks`, on.map((x) => x.id).join(','))
    }
    for (const tr of src.tracks.filter((x) => x.enabled)) {
      if (tr.name) args.push('--track-name', `${tr.id}:${tr.name}`)
      if (tr.lang) args.push('--language', `${tr.id}:${tr.lang}`)
      if (tr.type === 'subtitles' && tr.charset) args.push('--sub-charset', `${tr.id}:${tr.charset}`)
      args.push('--default-track-flag', `${tr.id}:${tr.isDefault ? 1 : 0}`)
      if (tr.isForced) args.push('--forced-display-flag', `${tr.id}:1`)
      if (tr.isCommentary) args.push('--commentary-flag', `${tr.id}:1`)
      if (tr.delay) args.push('--sync', `${tr.id}:${tr.delay}`)
    }
    if (!src.keepChapters && src.ident.container.properties.chapters) args.push('--no-chapters')
    args.push(src.path)
  }

  if (splitMode.value !== 'none' && splitValue.value.trim()) {
    const v = splitValue.value.trim()
    if (splitMode.value === 'duration') args.push('--split', `duration:${v}s`)
    else if (splitMode.value === 'size') args.push('--split', `sizes:${v}M`)
    else args.push('--split', `timestamps:${v}`)
  }
  if (chaptersFile.value) args.push('--chapters', chaptersFile.value)
  for (const a of attachments.value) {
    if (a.name) args.push('--attachment-name', a.name)
    args.push('--attach-file', a.path)
  }
  if (extraArgs.value.trim()) args.push(...tokenizeArgs(extraArgs.value))
  return args
})

const argvText = computed(() => argv.value.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '))

async function submit() {
  if (!outName.value || !outDir.value) {
    message.warning(t('muxer.needOutput'))
    return
  }
  if (!sources.value.length) {
    message.warning(t('muxer.noSources'))
    return
  }
  try {
    await api.createJob({ name: outName.value, tool: 'mkvmerge', argv: argv.value.slice(1) })
    message.success(t('muxer.submitted'))
  } catch (e: any) {
    message.error(e.message)
  }
}

// 草稿持久化：选项 + 输入文件/附件/轨道编辑（识别结果不存，恢复时重新识别回填）
const DRAFT_KEY = 'mkv.muxer'

function saveDraft() {
  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      outDir: outDir.value,
      outName: outName.value,
      segTitle: segTitle.value,
      splitMode: splitMode.value,
      splitValue: splitValue.value,
      chaptersFile: chaptersFile.value,
      extraArgs: extraArgs.value,
      attachments: attachments.value,
      sources: sources.value.map((s) => ({
        path: s.path,
        keepChapters: s.keepChapters,
        tracks: s.tracks.map((tr) => ({
          id: tr.id,
          enabled: tr.enabled,
          name: tr.name,
          lang: tr.lang,
          isDefault: tr.isDefault,
          isForced: tr.isForced,
          isCommentary: tr.isCommentary,
          delay: tr.delay,
          charset: tr.charset,
        })),
      })),
    })
  )
}
watch(
  [outDir, outName, segTitle, splitMode, splitValue, chaptersFile, extraArgs, sources, attachments],
  saveDraft,
  { deep: true }
)

onMounted(async () => {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (draft) {
      outDir.value = draft.outDir || ''
      outName.value = draft.outName || ''
      segTitle.value = draft.segTitle || ''
      splitMode.value = draft.splitMode || 'none'
      splitValue.value = draft.splitValue || ''
      chaptersFile.value = draft.chaptersFile || ''
      extraArgs.value = draft.extraArgs || ''
      if (Array.isArray(draft.attachments)) {
        attachments.value = draft.attachments.filter((a: any) => a && typeof a.path === 'string' && a.path)
      }
      if (Array.isArray(draft.sources)) await restoreSources(draft.sources)
    }
    if (!outDir.value) {
      const s = await api.settings()
      if (s.defaultOutputDir) outDir.value = s.defaultOutputDir
    }
  } catch {
    /* ignore */
  }
})

// 恢复输入文件：重新识别后按轨道 id 回填保存的编辑；文件已不存在则显示识别失败
async function restoreSources(saved: any[]) {
  const valid = saved.filter((s) => s && typeof s.path === 'string' && s.path)
  for (const s of valid) {
    const row = mkSource(s.path)
    row.keepChapters = s.keepChapters !== false
    sources.value.push(row)
  }
  const rows = sources.value.slice(sources.value.length - valid.length)
  await Promise.all(
    rows.map(async (row, i) => {
      await identifySource(row)
      const savedTracks = Array.isArray(valid[i].tracks) ? valid[i].tracks : []
      for (const tr of row.tracks) {
        const st = savedTracks.find((x: any) => x && x.id === tr.id)
        if (!st) continue
        tr.enabled = st.enabled !== false
        if (typeof st.name === 'string' && st.name) tr.name = st.name
        if (typeof st.lang === 'string' && st.lang) tr.lang = st.lang
        tr.isDefault = !!st.isDefault
        tr.isForced = !!st.isForced
        tr.isCommentary = !!st.isCommentary
        if (typeof st.delay === 'number') tr.delay = st.delay
        if (typeof st.charset === 'string' && st.charset) tr.charset = st.charset
      }
    })
  )
  await detectSubCharsets(rows)
}

// 一键清空：回到初始状态并清除本地草稿
function clearAll() {
  outDir.value = ''
  outName.value = ''
  segTitle.value = ''
  splitMode.value = 'none'
  splitValue.value = ''
  chaptersFile.value = ''
  sources.value = []
  attachments.value = []
  extraArgs.value = ''
  localStorage.removeItem(DRAFT_KEY)
}
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('muxer.output')">
      <template #header-extra>
        <NPopconfirm @positive-click="clearAll">
          <template #trigger>
            <NButton quaternary type="error" size="small">{{ $t('common.clearAll') }}</NButton>
          </template>
          {{ $t('common.clearAllConfirm') }}
        </NPopconfirm>
      </template>
      <NGrid :cols="2" :x-gap="12" :y-gap="12">
        <NGi>
          <div style="margin-bottom: 4px; font-size: 13px; opacity: 0.7">{{ $t('muxer.outputDir') }}</div>
          <NInput :value="outDir" readonly :placeholder="'/vol1/...'" @click="openBrowser('dir', 'outDir')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('dir', 'outDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi>
          <div style="margin-bottom: 4px; font-size: 13px; opacity: 0.7">{{ $t('muxer.outputName') }}</div>
          <NInput v-model:value="outName" placeholder="output.mkv" />
        </NGi>
        <NGi :span="2">
          <div style="margin-bottom: 4px; font-size: 13px; opacity: 0.7">{{ $t('muxer.segTitle') }}</div>
          <NInput v-model:value="segTitle" :placeholder="$t('muxer.segTitle')" clearable />
        </NGi>
      </NGrid>
    </NCard>

    <NCard :title="$t('muxer.sources')">
      <template #header-extra>
        <NButton type="primary" size="small" @click="openBrowser('file', 'src')">{{ $t('muxer.addSource') }}</NButton>
      </template>
      <NAlert v-if="!sources.length" type="info" :show-icon="false">{{ $t('muxer.noSources') }}</NAlert>
      <NSpace vertical v-for="(src, i) in sources" :key="src.path + i" size="small" style="margin-bottom: 8px">
        <NCard size="small">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px">
            <NTag size="small">#{{ i + 1 }}</NTag>
            <span style="flex: 1; word-break: break-all; font-size: 13px">{{ src.path }}</span>
            <NCheckbox v-model:checked="src.keepChapters">{{ $t('muxer.keepChapters') }}</NCheckbox>
            <NButton size="tiny" type="error" quaternary @click="removeSource(i)">{{ $t('common.remove') }}</NButton>
          </div>
          <div v-if="src.loading" style="opacity: 0.6; font-size: 13px">{{ $t('muxer.identifying') }}</div>
          <div v-else-if="src.error">
            <NAlert type="error" :show-icon="false">{{ $t('muxer.identifyFailed') }}: {{ src.error }}</NAlert>
          </div>
          <NTable v-else size="small" :single-line="false" :bordered="false">
            <thead>
              <tr>
                <th style="width: 40px">{{ $t('muxer.trackEnabled') }}</th>
                <th style="width: 40px">{{ $t('muxer.trackId') }}</th>
                <th style="width: 80px">{{ $t('muxer.trackType') }}</th>
                <th style="width: 120px">{{ $t('muxer.trackCodec') }}</th>
                <th>{{ $t('muxer.trackName') }}</th>
                <th style="width: 110px">{{ $t('muxer.trackLang') }}</th>
                <th v-if="src.isExternalSub" style="width: 120px">{{ $t('qsub.charset') }}</th>
                <th style="width: 60px">{{ $t('muxer.trackDefault') }}</th>
                <th style="width: 60px">{{ $t('muxer.trackForced') }}</th>
                <th style="width: 70px">{{ $t('muxer.trackCommentary') }}</th>
                <th style="width: 110px">{{ $t('muxer.trackDelay') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tr in src.tracks" :key="tr.id">
                <td><NCheckbox v-model:checked="tr.enabled" size="small" /></td>
                <td>{{ tr.id }}</td>
                <td><NTag size="tiny" :bordered="false">{{ tr.type }}</NTag></td>
                <td style="font-size: 12px">{{ tr.codec }}</td>
                <td><NInput v-model:value="tr.name" size="tiny" /></td>
                <td>
                  <NSelect
                    v-model:value="tr.lang"
                    size="tiny"
                    tag
                    filterable
                    :options="langOptions(tr.lang)"
                  />
                </td>
                <td v-if="src.isExternalSub">
                  <NSelect
                    v-if="tr.type === 'subtitles'"
                    :value="tr.charset || null"
                    size="tiny"
                    tag
                    filterable
                    clearable
                    :placeholder="$t('qsub.charsetNone')"
                    :options="charsetOptions(tr.charset)"
                    @update:value="(v: string | null) => (tr.charset = v || '')"
                  />
                </td>
                <td><NSwitch v-model:value="tr.isDefault" size="small" /></td>
                <td><NSwitch v-model:value="tr.isForced" size="small" /></td>
                <td><NSwitch v-model:value="tr.isCommentary" size="small" /></td>
                <td>
                  <NInputNumber v-model:value="tr.delay" size="tiny" :show-button="false" placeholder="0" style="width: 100%" />
                </td>
              </tr>
            </tbody>
          </NTable>
        </NCard>
      </NSpace>
    </NCard>

    <NCard :title="$t('muxer.split') + ' / ' + $t('muxer.chaptersFile') + ' / ' + $t('muxer.attachments')">
      <NGrid :cols="3" :x-gap="12">
        <NGi>
          <div style="margin-bottom: 4px; font-size: 13px; opacity: 0.7">{{ $t('muxer.split') }}</div>
          <NSpace>
            <NSelect
              v-model:value="splitMode"
              style="width: 180px"
              :options="[
                { label: $t('muxer.splitNone'), value: 'none' },
                { label: $t('muxer.splitDuration'), value: 'duration' },
                { label: $t('muxer.splitSize'), value: 'size' },
                { label: $t('muxer.splitTimestamps'), value: 'timestamps' },
              ]"
            />
            <NInput v-if="splitMode !== 'none'" v-model:value="splitValue" style="width: 160px" />
          </NSpace>
        </NGi>
        <NGi>
          <div style="margin-bottom: 4px; font-size: 13px; opacity: 0.7">{{ $t('muxer.chaptersFile') }}</div>
          <NInput :value="chaptersFile" readonly @click="openBrowser('file', 'chapters')" :placeholder="$t('common.none')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('file', 'chapters')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi>
          <div style="margin-bottom: 4px; font-size: 13px; opacity: 0.7">{{ $t('muxer.attachments') }}</div>
          <div v-for="(a, i) in attachments" :key="i" style="display: flex; gap: 6px; margin-bottom: 4px">
            <NInput v-model:value="a.name" size="small" :placeholder="$t('propedit.attachName')" />
            <NButton size="small" quaternary type="error" @click="attachments.splice(i, 1)">✕</NButton>
          </div>
          <NButton size="small" @click="openBrowser('file', 'attach')">{{ $t('common.add') }}</NButton>
        </NGi>
      </NGrid>
      <NDivider style="margin: 14px 0 8px" />
      <NInput v-model:value="extraArgs" type="textarea" :rows="2" :placeholder="$t('muxer.extraArgs')" />
    </NCard>

    <NCard>
      <NSpace vertical size="small">
        <code style="display: block; word-break: break-all; opacity: 0.75; font-size: 12px; max-height: 120px; overflow: auto">
          $ {{ argvText }}
        </code>
        <div style="display: flex; gap: 8px; align-items: center">
          <span style="opacity: 0.6; font-size: 12px">{{ $t('muxer.submitHint') }}</span>
          <div style="flex: 1" />
          <NPopconfirm v-if="sources.some((s) => s.error)">
            <template #trigger>
              <NButton type="error">{{ $t('common.submit') }}</NButton>
            </template>
            存在识别失败的输入文件，确认仍要提交？
          </NPopconfirm>
          <NButton v-else type="primary" size="large" @click="submit">{{ $t('common.submit') }}</NButton>
        </div>
      </NSpace>
    </NCard>

    <FileBrowser
      v-model:show="browser"
      :mode="browserMode"
      :multi="browserTarget === 'src' || browserTarget === 'attach'"
      filter="media"
      @select="onBrowserSelect"
      @select-multi="onBrowserSelectMulti"
    />
  </NSpace>
</template>
