<script setup lang="ts">
// 混流页：文件识别 + 轨道编辑 + mkvmerge 参数拼装
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NInputNumber, NSelect, NCheckbox, NSwitch, NTag,
  NGrid, NGi, NDivider, NTable, NAlert, NPopconfirm, useMessage,
} from 'naive-ui'
import { api, tokenizeArgs, type Identification } from '../api'
import FileBrowser from '../components/FileBrowser.vue'

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
}
interface Source {
  path: string
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

function openBrowser(mode: 'file' | 'dir', target: typeof browserTarget, index = -1) {
  browserMode.value = mode
  browserTarget = target
  activeSourceIndex = index
  browser.value = true
}

function identifyTrackProperties(props: Record<string, any>): Partial<UITrack> {
  return {
    name: props.track_name || '',
    lang: props.language || props.language_ietf || 'und',
    isDefault: !!props.default_track,
    isForced: !!props.forced_track,
    isCommentary: !!props.commentary_track,
  }
}

async function onBrowserSelect(p: string) {
  const target = browserTarget
  browserTarget = null
  if (!target) return
  if (target === 'outDir') outDir.value = p
  else if (target === 'chapters') chaptersFile.value = p
  else if (target === 'attach') attachments.value.push({ path: p, name: p.split(/[\\/]/).pop() || '' })
  else if (target === 'src') {
    const src: Source = { path: p, loading: true, error: '', ident: null, keepChapters: true, tracks: [] }
    sources.value.push(src)
    try {
      src.ident = await api.identify(p)
      src.tracks = src.ident.tracks.map((tr) => ({
        id: tr.id,
        type: tr.type,
        codec: tr.codec,
        enabled: true,
        ...identifyTrackProperties(tr.properties),
        delay: null,
      }))
    } catch (e: any) {
      src.error = e.message
    } finally {
      src.loading = false
    }
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

// 草稿持久化（不含输入文件识别结果）
watch(
  [outDir, outName, segTitle, splitMode, splitValue, chaptersFile],
  () => {
    localStorage.setItem(
      'mkv.muxer',
      JSON.stringify({
        outDir: outDir.value,
        outName: outName.value,
        segTitle: segTitle.value,
        splitMode: splitMode.value,
        splitValue: splitValue.value,
        chaptersFile: chaptersFile.value,
      })
    )
  },
  { deep: true }
)

onMounted(async () => {
  try {
    const draft = JSON.parse(localStorage.getItem('mkv.muxer') || 'null')
    if (draft) {
      outDir.value = draft.outDir || ''
      outName.value = draft.outName || ''
      segTitle.value = draft.segTitle || ''
      splitMode.value = draft.splitMode || 'none'
      splitValue.value = draft.splitValue || ''
      chaptersFile.value = draft.chaptersFile || ''
    }
    if (!outDir.value) {
      const s = await api.settings()
      if (s.defaultOutputDir) outDir.value = s.defaultOutputDir
    }
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('muxer.output')">
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
      filter="media"
      @select="onBrowserSelect"
    />
  </NSpace>
</template>
