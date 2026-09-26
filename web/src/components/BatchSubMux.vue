<script setup lang="ts">
// 批量内封：扫描视频/字幕目录，按文件名自动配对（支持视频带发布组标签、字幕被重命名干净的场景），
// 一键把每一组提交为独立的 mkvmerge 任务。字符集检测与快速内封共用同一后端接口。
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NCheckbox, NTag, NAlert, NTable, NSpin, NGrid, NGi, useMessage,
} from 'naive-ui'
import { api, type FileEntry } from '../api'
import FileBrowser from '../components/FileBrowser.vue'
import {
  buildSubMuxArgv, defaultOutputFor, guessLanguage, joinPath, pairVideos,
  SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS, extOf, type SubRow,
} from '../subtitles'

const { t } = useI18n()
const message = useMessage()

const videoDir = ref('')
const subDir = ref('')
const outDir = ref('')
const outSuffix = ref('.subs')
const dropEmbedded = ref(false)

interface ScanRow {
  video: FileEntry
  subs: FileEntry[]
  include: boolean
}
const rows = ref<ScanRow[]>([])
const unmatchedVideos = ref<FileEntry[]>([])
const unmatchedSubs = ref<FileEntry[]>([])
const charsetMap = ref<Record<string, string | null>>({})
const scanning = ref(false)
const submitting = ref(false)
const scanned = ref(false)

const browser = ref(false)
let browserTarget: 'videoDir' | 'subDir' | 'outDir' | null = null

function openBrowser(target: typeof browserTarget) {
  browserTarget = target
  browser.value = true
}

function onBrowserSelect(p: string) {
  const target = browserTarget
  browserTarget = null
  if (target === 'videoDir') videoDir.value = p
  else if (target === 'subDir') subDir.value = p
  else if (target === 'outDir') outDir.value = p
}

function outNameFor(videoPath: string) {
  return defaultOutputFor(videoPath, outSuffix.value).name
}

function rowOutDir(videoPath: string) {
  return outDir.value || videoPath.slice(0, Math.max(videoPath.lastIndexOf('/'), videoPath.lastIndexOf('\\')))
}

function rowToSubRows(subs: FileEntry[]): SubRow[] {
  return subs.map((s, i) => {
    const g = guessLanguage(s.name)
    return {
      path: s.path,
      fileName: s.name,
      lang: g?.lang || 'und',
      trackName: g?.name || '',
      isDefault: i === 0, // 组内已按 简>繁>英>其他 排序，第一条做默认
      isForced: false,
      charset: charsetMap.value[s.path] || '',
    }
  })
}

async function scan() {
  if (!videoDir.value) {
    message.warning(t('bsub.needVideoDir'))
    return
  }
  scanning.value = true
  try {
    const [vres, sres] = await Promise.all([
      api.files(videoDir.value, 'media'),
      api.files(subDir.value || videoDir.value, 'media'),
    ])
    const videos = vres.entries.filter((e) => !e.isDir && VIDEO_EXTENSIONS.has(extOf(e.name)))
    const subFiles = sres.entries.filter((e) => !e.isDir && SUBTITLE_EXTENSIONS.has(extOf(e.name)))
    const pr = pairVideos(videos, subFiles, outSuffix.value)
    rows.value = pr.rows.map((r) => ({ ...r, include: true }))
    unmatchedVideos.value = pr.unmatchedVideos
    unmatchedSubs.value = pr.unmatchedSubs
    scanned.value = true

    // 批量字符集检测（全部字幕一次性发给后端）
    charsetMap.value = {}
    const allSubs = pr.rows.flatMap((r) => r.subs)
    if (allSubs.length) {
      const items = allSubs.map((s) => ({ path: s.path, hint: guessLanguage(s.name)?.hint || '' }))
      try {
        const { results } = await api.detectCharsets(items)
        charsetMap.value = results
      } catch {
        /* 检测失败则不指定字符集 */
      }
    }
  } catch (e: any) {
    message.error(e.message)
  } finally {
    scanning.value = false
  }
}

async function submit() {
  const included = rows.value.filter((r) => r.include)
  if (!included.length) {
    message.warning(t('bsub.noPairs'))
    return
  }
  submitting.value = true
  let ok = 0
  let failed = 0
  for (const r of included) {
    const outPath = joinPath(rowOutDir(r.video.path), outNameFor(r.video.path))
    // 输出与某个输入同路径（如后缀被清空且视频本身是 mkv），跳过以免覆盖源文件
    if (outPath === r.video.path || r.subs.some((s) => s.path === outPath)) {
      failed++
      continue
    }
    const argv = buildSubMuxArgv({
      outPath,
      videoPath: r.video.path,
      dropEmbeddedSubs: dropEmbedded.value,
      subs: rowToSubRows(r.subs),
    })
    try {
      await api.createJob({ name: outNameFor(r.video.path), tool: 'mkvmerge', argv })
      ok++
    } catch {
      failed++
    }
  }
  submitting.value = false
  if (ok) message.success(t('bsub.submitted', { n: ok }))
  if (failed) message.error(t('bsub.failed', { n: failed }))
}

const DRAFT_KEY = 'mkv.batchsubs'

onMounted(() => {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (draft) {
      videoDir.value = draft.videoDir || ''
      subDir.value = draft.subDir || ''
      outDir.value = draft.outDir || ''
      outSuffix.value = draft.outSuffix || '.subs'
      dropEmbedded.value = !!draft.dropEmbedded
    }
  } catch {
    /* ignore */
  }
})

function saveDraft() {
  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      videoDir: videoDir.value,
      subDir: subDir.value,
      outDir: outDir.value,
      outSuffix: outSuffix.value,
      dropEmbedded: dropEmbedded.value,
    })
  )
}
watch([videoDir, subDir, outDir, outSuffix, dropEmbedded], saveDraft)
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('bsub.dirs')">
      <NGrid :cols="3" :x-gap="12" :y-gap="12">
        <NGi>
          <div class="field-label">{{ $t('bsub.videoDir') }}</div>
          <NInput :value="videoDir" readonly placeholder="/vol1/..." @click="openBrowser('videoDir')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('videoDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi>
          <div class="field-label">{{ $t('bsub.subDir') }}</div>
          <NInput
            :value="subDir"
            readonly
            :placeholder="$t('bsub.sameAsVideo')"
            @click="openBrowser('subDir')"
          >
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('subDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi>
          <div class="field-label">{{ $t('bsub.outDir') }}</div>
          <NInput :value="outDir" readonly :placeholder="$t('bsub.sameAsVideo')" @click="openBrowser('outDir')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('outDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi>
          <div class="field-label">{{ $t('bsub.suffix') }}</div>
          <NInput v-model:value="outSuffix" placeholder=".subs" />
        </NGi>
        <NGi :span="2">
          <div class="field-label">&nbsp;</div>
          <NCheckbox v-model:checked="dropEmbedded">{{ $t('qsub.dropEmbedded') }}</NCheckbox>
        </NGi>
      </NGrid>
      <div style="margin-top: 8px; font-size: 12px; opacity: 0.55">{{ $t('bsub.suffixHint') }}</div>
      <div style="margin-top: 12px">
        <NButton type="primary" :loading="scanning" @click="scan">{{ $t('bsub.scan') }}</NButton>
      </div>
    </NCard>

    <template v-if="scanned">
      <NCard :title="$t('bsub.result', { n: rows.length })">
        <template #header-extra>
          <NButton type="primary" :loading="submitting" :disabled="!rows.some((r) => r.include)" @click="submit">
            {{ $t('bsub.submitAll', { n: rows.filter((r) => r.include).length }) }}
          </NButton>
        </template>
        <NAlert v-if="!rows.length" type="info" :show-icon="false">{{ $t('bsub.noPairs') }}</NAlert>
        <NTable v-else size="small" :single-line="false" :bordered="false">
          <thead>
            <tr>
              <th style="width: 50px">{{ $t('bsub.colInclude') }}</th>
              <th>{{ $t('bsub.colVideo') }}</th>
              <th>{{ $t('bsub.colSubs') }}</th>
              <th style="width: 30%">{{ $t('bsub.colOut') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.video.path">
              <td><NCheckbox v-model:checked="r.include" size="small" /></td>
              <td style="word-break: break-all; font-size: 12px">{{ r.video.path }}</td>
              <td>
                <NSpace size="small">
                  <NTag
                    v-for="s in r.subs"
                    :key="s.path"
                    size="tiny"
                    :bordered="false"
                    :type="guessLanguage(s.name)?.hint === 'zh-hans' ? 'success' : 'default'"
                  >
                    {{ s.name }}<template v-if="charsetMap[s.path]"> · {{ charsetMap[s.path] }}</template>
                  </NTag>
                </NSpace>
              </td>
              <td style="font-size: 12px; opacity: 0.75">
                {{ joinPath(rowOutDir(r.video.path), outNameFor(r.video.path)) }}
              </td>
            </tr>
          </tbody>
        </NTable>
        <div v-if="rows.length" style="margin-top: 8px; font-size: 12px; opacity: 0.6">
          <div v-if="unmatchedVideos.length">{{ $t('bsub.unmatchedVideos', { n: unmatchedVideos.length }) }}：{{ unmatchedVideos.map((v) => v.name).join('、') }}</div>
          <div v-if="unmatchedSubs.length">{{ $t('bsub.unmatchedSubs', { n: unmatchedSubs.length }) }}：{{ unmatchedSubs.map((s) => s.name).join('、') }}</div>
        </div>
      </NCard>
    </template>

    <NSpin v-if="scanning" style="display: block; text-align: center; padding: 20px">{{ $t('common.loading') }}</NSpin>

    <FileBrowser
      v-model:show="browser"
      mode="dir"
      filter="media"
      @select="onBrowserSelect"
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
