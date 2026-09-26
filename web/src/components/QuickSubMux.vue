<script setup lang="ts">
// 快速内封字幕：一个视频 + 多条外挂字幕。
// 自动化：输出位置按视频推导、语言/轨道名从文件名猜测、字符集服务端检测（GBK/Big5 SRT 防乱码）、
// 默认轨道唯一化。拼出的参数仍走通用任务队列。
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NSelect, NSwitch, NTag, NAlert, NCheckbox, NSpin,
  NGrid, NGi, useMessage,
} from 'naive-ui'
import { api, type Identification } from '../api'
import FileBrowser from '../components/FileBrowser.vue'
import {
  buildSubMuxArgv, defaultOutputFor, guessLanguage, joinPath, SUB_CHARSETS, SUB_LANG_PRESETS,
  SUBTITLE_EXTENSIONS, extOf, type SubRow,
} from '../subtitles'

const { t } = useI18n()
const message = useMessage()

const videoPath = ref('')
const videoLoading = ref(false)
const videoError = ref('')
const videoIdent = ref<Identification | null>(null)

const subs = ref<SubRow[]>([])
const dropEmbedded = ref(false)
const segTitle = ref('')
const outDir = ref('')
const outName = ref('')

const browser = ref(false)
let browserTarget: 'video' | 'subs' | 'outDir' | null = null

function openBrowser(target: typeof browserTarget) {
  browserTarget = target
  browser.value = true
}

const embeddedCount = computed(
  () => videoIdent.value?.tracks.filter((tr) => tr.type === 'subtitles').length || 0
)
const summary = computed(() => {
  const trs = videoIdent.value?.tracks || []
  const v = trs.filter((x) => x.type === 'video').map((x) => x.codec).join(' + ') || '—'
  const a = trs.filter((x) => x.type === 'audio').length
  const s = embeddedCount.value
  return t('qsub.summary', { v, a, s })
})

const langOptions = (current: string) =>
  [...new Set([current, ...SUB_LANG_PRESETS])]
    .filter(Boolean)
    .map((v) => ({ label: v, value: v }))
const charsetOptions = (current: string) =>
  [...new Set([current, ...SUB_CHARSETS])].filter(Boolean).map((v) => ({ label: v, value: v }))

async function pickVideo(p: string) {
  videoPath.value = p
  videoError.value = ''
  videoIdent.value = null
  const out = defaultOutputFor(p)
  outDir.value = out.dir
  outName.value = out.name
  await identifyVideo()
}

async function identifyVideo() {
  videoLoading.value = true
  try {
    videoIdent.value = await api.identify(videoPath.value)
  } catch (e: any) {
    videoError.value = e.message
  } finally {
    videoLoading.value = false
  }
}

function makeSubRow(p: string): SubRow {
  const fileName = p.split(/[\\/]/).pop() || p
  const g = guessLanguage(fileName)
  return {
    path: p,
    fileName,
    lang: g?.lang || 'und',
    trackName: g?.name || '',
    isDefault: false,
    isForced: false,
    charset: '',
  }
}

async function addSubs(paths: string[]) {
  const existing = new Set(subs.value.map((s) => s.path))
  const fresh = paths
    .filter((p) => !existing.has(p) && SUBTITLE_EXTENSIONS.has(extOf(p)))
    .map(makeSubRow)
  if (!fresh.length) return
  subs.value.push(...fresh)
  // 之后一切赋值都要走 subs.value 里的响应式代理，改 raw 对象不会触发更新
  const rows = subs.value.slice(subs.value.length - fresh.length)
  if (!subs.value.some((s) => s.isDefault)) rows[0].isDefault = true
  await detectCharsets(rows)
}

// 字符集检测：hint 取自文件名语言猜测，GBK/Big5 靠它消歧
async function detectCharsets(targets: SubRow[]) {
  if (!targets.length) return
  const want = new Set(targets.map((r) => r.path))
  const items = targets.map((r) => ({ path: r.path, hint: guessLanguage(r.fileName)?.hint || '' }))
  try {
    const { results } = await api.detectCharsets(items)
    for (const r of subs.value) {
      const cs = results[r.path]
      if (cs && want.has(r.path)) r.charset = cs
    }
  } catch {
    /* 检测失败则不指定字符集 */
  }
}

function setDefault(row: SubRow, v: boolean) {
  if (v) subs.value.forEach((s) => (s.isDefault = s === row))
  else row.isDefault = false
}

function removeSub(i: number) {
  const wasDefault = subs.value[i].isDefault
  subs.value.splice(i, 1)
  if (wasDefault && subs.value.length) subs.value[0].isDefault = true
}

function onBrowserSelect(p: string) {
  const target = browserTarget
  browserTarget = null
  if (!target) return
  if (target === 'video') pickVideo(p)
  else if (target === 'outDir') outDir.value = p
}

function onBrowserSelectMulti(paths: string[]) {
  browserTarget = null
  addSubs(paths)
}

const outPath = computed(() => joinPath(outDir.value, outName.value || 'output.mkv'))
const argv = computed(() => {
  if (!videoPath.value || !subs.value.length) return []
  return buildSubMuxArgv({
    outPath: outPath.value,
    videoPath: videoPath.value,
    dropEmbeddedSubs: dropEmbedded.value,
    segTitle: segTitle.value.trim() || undefined,
    subs: subs.value,
  })
})
const argvText = computed(() => argv.value.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '))

async function submit() {
  if (!videoPath.value) {
    message.warning(t('qsub.needVideo'))
    return
  }
  if (!subs.value.length) {
    message.warning(t('qsub.needSubs'))
    return
  }
  const conflict = outPath.value === videoPath.value || subs.value.some((s) => s.path === outPath.value)
  if (conflict) {
    message.error(t('qsub.conflict'))
    return
  }
  try {
    await api.createJob({ name: outName.value || 'output.mkv', tool: 'mkvmerge', argv: argv.value })
    message.success(t('muxer.submitted'))
  } catch (e: any) {
    message.error(e.message)
  }
}

const DRAFT_KEY = 'mkv.quicksubs'

function saveDraft() {
  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      videoPath: videoPath.value,
      outDir: outDir.value,
      outName: outName.value,
      segTitle: segTitle.value,
      dropEmbedded: dropEmbedded.value,
      subs: subs.value,
    })
  )
}
watch([videoPath, outDir, outName, segTitle, dropEmbedded, subs], saveDraft, { deep: true })

onMounted(async () => {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (draft) {
      videoPath.value = draft.videoPath || ''
      outDir.value = draft.outDir || ''
      outName.value = draft.outName || ''
      segTitle.value = draft.segTitle || ''
      dropEmbedded.value = !!draft.dropEmbedded
      subs.value = Array.isArray(draft.subs) ? draft.subs : []
      if (videoPath.value) identifyVideo()
      if (subs.value.length) await detectCharsets(subs.value.filter((s) => !s.charset))
    }
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('qsub.video')">
      <div style="display: flex; gap: 8px; align-items: center">
        <NInput
          :value="videoPath"
          readonly
          :placeholder="$t('qsub.chooseVideo')"
          @click="openBrowser('video')"
        >
          <template #suffix>
            <NButton quaternary size="tiny" @click.stop="openBrowser('video')">{{ $t('common.browse') }}</NButton>
          </template>
        </NInput>
        <NButton v-if="videoPath && !videoLoading" size="small" @click="identifyVideo">{{ $t('common.refresh') }}</NButton>
      </div>
      <NSpin v-if="videoLoading" size="small" style="margin-top: 8px">{{ $t('muxer.identifying') }}</NSpin>
      <NAlert v-else-if="videoError" type="error" :show-icon="false" style="margin-top: 8px">
        {{ $t('muxer.identifyFailed') }}: {{ videoError }}
      </NAlert>
      <template v-else-if="videoIdent">
        <div style="margin-top: 8px; font-size: 13px; opacity: 0.75">{{ summary }}</div>
        <NAlert
          v-if="embeddedCount && !dropEmbedded"
          type="info"
          :show-icon="false"
          style="margin-top: 8px"
        >{{ $t('qsub.embeddedKept', { n: embeddedCount }) }}</NAlert>
      </template>
      <div style="margin-top: 8px">
        <NCheckbox v-model:checked="dropEmbedded">{{ $t('qsub.dropEmbedded') }}</NCheckbox>
      </div>
    </NCard>

    <NCard :title="$t('qsub.subs')">
      <template #header-extra>
        <NButton type="primary" size="small" @click="openBrowser('subs')">{{ $t('qsub.addSubs') }}</NButton>
      </template>
      <NAlert v-if="!subs.length" type="info" :show-icon="false">{{ $t('qsub.emptySubs') }}</NAlert>
      <NCard v-for="(s, i) in subs" :key="s.path" size="small" style="margin-bottom: 8px">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
          <NTag size="small" :bordered="false">{{ i + 1 }}</NTag>
          <span style="flex: 1; word-break: break-all; font-size: 13px">{{ s.path }}</span>
          <NButton size="tiny" type="error" quaternary @click="removeSub(i)">{{ $t('common.remove') }}</NButton>
        </div>
        <NGrid :cols="4" :x-gap="12" :y-gap="8">
          <NGi>
            <div class="field-label">{{ $t('qsub.lang') }}</div>
            <NSelect v-model:value="s.lang" size="small" tag filterable :options="langOptions(s.lang)" />
          </NGi>
          <NGi :span="2">
            <div class="field-label">{{ $t('qsub.trackName') }}</div>
            <NInput v-model:value="s.trackName" size="small" />
          </NGi>
          <NGi>
            <div class="field-label">{{ $t('qsub.charset') }}</div>
            <NSelect
              :value="s.charset || null"
              size="small"
              tag
              filterable
              clearable
              :placeholder="$t('qsub.charsetNone')"
              :options="charsetOptions(s.charset)"
              @update:value="(v: string | null) => (s.charset = v || '')"
            />
          </NGi>
          <NGi>
            <div class="field-label">{{ $t('qsub.def') }}</div>
            <NSwitch :value="s.isDefault" size="small" @update:value="(v: boolean) => setDefault(s, v)" />
          </NGi>
          <NGi>
            <div class="field-label">{{ $t('qsub.forced') }}</div>
            <NSwitch v-model:value="s.isForced" size="small" />
          </NGi>
        </NGrid>
      </NCard>
    </NCard>

    <NCard :title="$t('muxer.output')">
      <NGrid :cols="2" :x-gap="12" :y-gap="12">
        <NGi>
          <div class="field-label">{{ $t('muxer.outputDir') }}</div>
          <NInput :value="outDir" readonly placeholder="/vol1/..." @click="openBrowser('outDir')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('outDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi>
          <div class="field-label">{{ $t('muxer.outputName') }}</div>
          <NInput v-model:value="outName" placeholder="output.mkv" />
        </NGi>
        <NGi :span="2">
          <div class="field-label">{{ $t('muxer.segTitle') }}</div>
          <NInput v-model:value="segTitle" clearable :placeholder="$t('common.none')" />
        </NGi>
      </NGrid>
      <div style="margin-top: 8px; font-size: 12px; opacity: 0.55">{{ $t('qsub.autoOut') }}</div>
    </NCard>

    <NCard>
      <NSpace vertical size="small">
        <code v-if="argv.length" style="display: block; word-break: break-all; opacity: 0.75; font-size: 12px; max-height: 120px; overflow: auto">
          $ mkvmerge {{ argvText }}
        </code>
        <div style="display: flex; gap: 8px; align-items: center">
          <span style="opacity: 0.6; font-size: 12px">{{ $t('muxer.submitHint') }}</span>
          <div style="flex: 1" />
          <NButton type="primary" size="large" :disabled="!argv.length" @click="submit">{{ $t('common.submit') }}</NButton>
        </div>
      </NSpace>
    </NCard>

    <FileBrowser
      v-model:show="browser"
      :mode="browserTarget === 'outDir' ? 'dir' : 'file'"
      :multi="browserTarget === 'subs'"
      filter="media"
      @select="onBrowserSelect"
      @select-multi="onBrowserSelectMulti"
    />
  </NSpace>
</template>

<style scoped>
.field-label {
  margin-bottom: 4px;
  font-size: 13px;
  opacity: 0.7;
}
</style>
