<script setup lang="ts">
// 提取页：mkvextract 全模式
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NCheckbox, NTag, NAlert, NTable, NInputNumber, useMessage,
} from 'naive-ui'
import { api, fmtSize, type Identification } from '../api'
import FileBrowser from '../components/FileBrowser.vue'

const { t } = useI18n()
const message = useMessage()

const src = ref('')
const outDir = ref('')
const ident = ref<Identification | null>(null)
const identifying = ref(false)

// 轨道提取
const trackSel = ref<Record<number, boolean>>({})
const trackOut = ref<Record<number, string>>({})
// 附件提取
const attachSel = ref<Record<number, boolean>>({})
// 章节与文本类
const wantChapters = ref(false)
const chaptersSimple = ref(false)
const wantTags = ref(false)
const wantCuesheet = ref(false)
const wantCues = ref(false)
const tsSel = ref<Record<number, boolean>>({})

const browser = ref(false)
const browserMode = ref<'file' | 'dir'>('file')
const browserFor = ref<'src' | 'outDir'>('src')

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
  [/ass|ssa/i, 'ass'],
  [/pgs|hdmv/i, 'sup'],
  [/vobsub|subrip? bitmap/i, 'sub'],
  [/webvtt/i, 'vtt'],
  [/utf-?8|txt/i, 'txt'],
]

function defaultExt(codec: string, type: string) {
  for (const [re, ext] of CODEC_EXT) if (re.test(codec)) return ext
  return type === 'subtitles' ? 'sub' : type === 'video' ? 'mkv' : 'bin'
}

function openBrowser(mode: 'file' | 'dir', which: 'src' | 'outDir') {
  browserMode.value = mode
  browserFor.value = which
  browser.value = true
}

async function onBrowserSelect(p: string) {
  if (browserFor.value === 'outDir') {
    outDir.value = p
    return
  }
  src.value = p
  ident.value = null
  trackSel.value = {}
  trackOut.value = {}
  attachSel.value = {}
  tsSel.value = {}
  identifying.value = true
  try {
    ident.value = await api.identify(p)
    const base = p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
    for (const tr of ident.value?.tracks || []) {
      trackSel.value[tr.id] = false
      tsSel.value[tr.id] = false
      trackOut.value[tr.id] = `${base}.track${tr.id}.${defaultExt(tr.codec, tr.type)}`
    }
    for (const a of ident.value?.attachments || []) attachSel.value[a.id] = false
  } catch (e: any) {
    message.error(e.message)
  } finally {
    identifying.value = false
  }
}

function outPath(name: string) {
  return (outDir.value.replace(/[\\/]+$/, '') + '/' + name).replace(/^\/+/, '/')
}

const argv = computed<string[] | null>(() => {
  if (!src.value || !outDir.value) return null
  // 现行参数序：源文件在最前，其后依次为各模式与提取规格（mkvextract 官方文档用法）
  const args: string[] = [src.value]
  const tracks = (ident.value?.tracks || []).filter((tr) => trackSel.value[tr.id])
  if (tracks.length) {
    args.push('tracks')
    for (const tr of tracks) args.push(`${tr.id}:${outPath(trackOut.value[tr.id] || `track${tr.id}.bin`)}`)
  }
  const ts = (ident.value?.tracks || []).filter((tr) => tsSel.value[tr.id])
  if (ts.length) {
    args.push('timestamps_v2')
    for (const tr of ts) args.push(`${tr.id}:${outPath(`timestamps_${tr.id}.txt`)}`)
  }
  const atts = (ident.value?.attachments || []).filter((a) => attachSel.value[a.id])
  if (atts.length) {
    args.push('attachments')
    for (const a of atts) args.push(`${a.id}:${outPath(a.name || `attachment_${a.id}`)}`)
  }
  if (wantChapters.value) args.push('chapters', ...(chaptersSimple.value ? ['-s'] : []), outPath('chapters.xml'))
  if (wantTags.value) args.push('tags', outPath('tags.xml'))
  if (wantCuesheet.value) args.push('cuesheet', outPath('cuesheet.cue'))
  if (wantCues.value) args.push('cues', outPath('cues.cue'))
  return args.length > 1 ? args : null
})

const argvText = computed(() => (argv.value ? ['mkvextract', ...argv.value].join(' ') : ''))

async function submit() {
  if (!argv.value) {
    message.warning(t('extract.pickSomething'))
    return
  }
  try {
    await api.createJob({
      name: `extract ${src.value.split(/[\\/]/).pop()}`,
      tool: 'mkvextract',
      argv: argv.value,
    })
    message.success(t('extract.submitted'))
  } catch (e: any) {
    message.error(e.message)
  }
}

onMounted(async () => {
  try {
    const s = await api.settings()
    if (s.defaultOutputDir) outDir.value = s.defaultOutputDir
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('extract.title')">
      <NSpace vertical size="small">
        <div style="display: flex; gap: 8px; align-items: center">
          <NTag size="small">{{ $t('extract.source') }}</NTag>
          <NInput :value="src" readonly :placeholder="$t('info.noFile')" @click="openBrowser('file', 'src')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('file', 'src')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
          <NTag size="small">{{ $t('extract.outputDir') }}</NTag>
          <NInput :value="outDir" readonly @click="openBrowser('dir', 'outDir')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('dir', 'outDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </div>
      </NSpace>
    </NCard>

    <NCard v-if="ident" :title="$t('extract.mode')">
      <NSpace vertical size="large">
        <div>
          <b style="font-size: 13px">{{ $t('extract.tracks') }}</b>
          <NTable size="small" :single-line="false" :bordered="false" style="margin-top: 6px">
            <thead>
              <tr>
                <th style="width: 60px"></th>
                <th style="width: 40px">ID</th>
                <th style="width: 80px">{{ $t('info.type') }}</th>
                <th style="width: 140px">{{ $t('info.codec') }}</th>
                <th>{{ $t('extract.outName') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tr in ident?.tracks" :key="'t' + tr.id">
                <td><NCheckbox v-model:checked="trackSel[tr.id]" size="small" /></td>
                <td>{{ tr.id }}</td>
                <td><NTag size="tiny" :bordered="false">{{ tr.type }}</NTag></td>
                <td style="font-size: 12px">{{ tr.codec }}</td>
                <td>
                  <NInput v-if="trackSel[tr.id]" v-model:value="trackOut[tr.id]" size="small" />
                </td>
              </tr>
            </tbody>
          </NTable>
        </div>

        <div v-if="(ident?.attachments || []).length">
          <b style="font-size: 13px">{{ $t('extract.attachments') }}</b>
          <NTable size="small" :single-line="false" :bordered="false" style="margin-top: 6px">
            <thead>
              <tr>
                <th style="width: 60px"></th>
                <th style="width: 40px">ID</th>
                <th>{{ $t('common.fileName') }}</th>
                <th style="width: 100px">{{ $t('common.size') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in ident?.attachments" :key="'a' + a.id">
                <td><NCheckbox v-model:checked="attachSel[a.id]" size="small" /></td>
                <td>{{ a.id }}</td>
                <td>{{ a.name }}</td>
                <td>{{ fmtSize(a.size) }}</td>
              </tr>
            </tbody>
          </NTable>
        </div>

        <NSpace>
          <NCheckbox v-model:checked="wantChapters">{{ $t('extract.chaptersMode') }}</NCheckbox>
          <NCheckbox v-if="wantChapters" v-model:checked="chaptersSimple">{{ $t('extract.simpleChapters') }}</NCheckbox>
          <NCheckbox v-model:checked="wantTags">{{ $t('extract.tags') }}</NCheckbox>
          <NCheckbox v-model:checked="wantCuesheet">{{ $t('extract.cuesheet') }}</NCheckbox>
          <NCheckbox v-model:checked="wantCues">{{ $t('extract.cues') }}</NCheckbox>
        </NSpace>

        <div>
          <b style="font-size: 13px">{{ $t('extract.timestamps') }}</b>
          <NSpace style="margin-top: 6px">
            <NCheckbox
              v-for="tr in ident?.tracks"
              :key="'ts' + tr.id"
              v-model:checked="tsSel[tr.id]"
              size="small"
            >#{{ tr.id }} {{ tr.type }}</NCheckbox>
          </NSpace>
        </div>

        <NAlert v-if="argvText" type="info" :show-icon="false">
          <code style="word-break: break-all; font-size: 12px">$ {{ argvText }}</code>
        </NAlert>
        <NButton type="primary" :disabled="!argv" @click="submit">{{ $t('common.submit') }}</NButton>
      </NSpace>
    </NCard>
    <NAlert v-else-if="!identifying" type="info" :show-icon="false">{{ $t('info.noFile') }}</NAlert>

    <FileBrowser v-model:show="browser" :mode="browserMode" :filter="browserFor === 'src' ? 'media' : ''" @select="onBrowserSelect" />
  </NSpace>
</template>
