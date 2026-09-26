<script setup lang="ts">
// 字幕改名：扫描视频/字幕目录自动配对（复用批量内封的两轮匹配），把字幕批量改名为
// 「视频文件名[.语言标记].原扩展名」，或追加固定语言后缀（sc/tc/jpsc 等，取自语言识别列表），
// 改完即可被批量内封与播放器按名识别。
// 自动匹配有误时全链路可手动纠正：换绑目标视频、直接改新文件名；未匹配字幕可手动指定视频后一并改名。
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NCheckbox, NAlert, NTable, NSpin, NGrid, NGi, NSelect, NTag, NPopconfirm, useMessage,
} from 'naive-ui'
import { api, type FileEntry, type RenameResult } from '../api'
import FileBrowser from '../components/FileBrowser.vue'
import { extOf, langTokenOf, pairVideos, pairingKey, LANG_SUFFIX_PRESETS, SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from '../subtitles'

const { t } = useI18n()
const message = useMessage()

const videoDir = ref('')
const subDir = ref('')
const keepLang = ref(true)
const addSuffix = ref('') // 非空 = 追加固定语言后缀（与 keepLang 互斥）
const moveToVideo = ref(false)
const overwrite = ref(false)

type RowStatus = 'same' | 'ready' | 'unset' | 'conflict' | 'done' | 'failed'

interface RenameRow {
  sub: FileEntry // 实际改名的字幕文件（.idx 行的伴生 .sub 记在 companionSub，成对改名）
  companionSub: FileEntry | null
  videoPath: string // 目标视频路径，'' = 未指定
  newName: string // 目标文件名（不含目录，可编辑）
  nameEdited: boolean // 手改过新名后，切换语言标记选项时不再自动重算
  include: boolean
  status: RowStatus
  error: string
}

const videos = ref<FileEntry[]>([])
const rows = ref<RenameRow[]>([])
const unmatchedVideos = ref<FileEntry[]>([])
const scanning = ref(false)
const submitting = ref(false)
const scanned = ref(false)

const browser = ref(false)
let browserTarget: 'videoDir' | 'subDir' | null = null

function openBrowser(target: typeof browserTarget) {
  browserTarget = target
  browser.value = true
}

function onBrowserSelect(p: string) {
  const target = browserTarget
  browserTarget = null
  if (target === 'videoDir') videoDir.value = p
  else if (target === 'subDir') subDir.value = p
}

// ---------- 文件名工具（保持源路径的分隔符风格，fnOS 为 / 、Windows 开发为 \） ----------
function rawExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1) : ''
}
function baseOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}
function leafOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}
function joinName(dir: string, name: string): string {
  if (!dir) return name
  return dir + (dir.includes('\\') ? '\\' : '/') + name
}

// 新名 = 视频文件名[.语言标记|.指定后缀].原扩展名
function deriveName(videoName: string, subName: string): string {
  if (addSuffix.value) return baseOf(videoName) + '.' + addSuffix.value + '.' + rawExt(subName)
  const tok = keepLang.value ? langTokenOf(subName) : ''
  return baseOf(videoName) + (tok ? '.' + tok : '') + '.' + rawExt(subName)
}

function targetDirFor(r: RenameRow): string {
  if (moveToVideo.value && r.videoPath) return dirOf(r.videoPath)
  return dirOf(r.sub.path)
}

function targetPathFor(r: RenameRow): string {
  return joinName(targetDirFor(r), r.newName.trim())
}

// ---------- 状态计算 ----------
// 冲突检测：活跃行（未落盘定型）的目标路径互斥；"无需改名"的行不参与（文件本就存在于盘上，交给执行时后端校验）。
function refreshStatuses() {
  const counts = new Map<string, number>()
  const paths = new Map<RenameRow, string>()
  const compPaths = new Map<RenameRow, string>()
  for (const r of rows.value) {
    if (r.status === 'done' || r.status === 'failed') continue
    const name = r.newName.trim()
    if (!name) {
      r.status = 'unset'
      continue
    }
    const to = targetPathFor(r)
    if (to === r.sub.path) {
      r.status = 'same'
      continue
    }
    paths.set(r, to)
    counts.set(to, (counts.get(to) || 0) + 1)
    if (r.companionSub) {
      const cTo = joinName(dirOf(to), baseOf(name) + '.' + rawExt(r.companionSub.name))
      compPaths.set(r, cTo)
      counts.set(cTo, (counts.get(cTo) || 0) + 1)
    }
  }
  for (const [r, to] of paths) {
    const dup =
      (counts.get(to) || 0) > 1 ||
      (r.companionSub ? (counts.get(compPaths.get(r)!) || 0) > 1 : false)
    r.status = dup ? 'conflict' : 'ready'
  }
}

// 已落盘（done/failed）的行重新编辑后回到可执行状态
function touch(r: RenameRow) {
  if (r.status === 'done' || r.status === 'failed') r.status = 'ready'
  refreshStatuses()
}

function onVideoChange(r: RenameRow, v: string | null) {
  r.videoPath = v || ''
  const ve = videos.value.find((x) => x.path === r.videoPath)
  if (ve) {
    r.newName = deriveName(ve.name, r.sub.name)
    r.nameEdited = false
  }
  touch(r)
}

function onNameInput(r: RenameRow, v: string) {
  r.newName = v
  r.nameEdited = true
  touch(r)
}

// ---------- 扫描 ----------
async function scan() {
  if (!videoDir.value) {
    message.warning(t('srn.needVideoDir'))
    return
  }
  scanning.value = true
  try {
    const [vres, sres] = await Promise.all([
      api.files(videoDir.value, 'media'),
      api.files(subDir.value || videoDir.value, 'media'),
    ])
    videos.value = vres.entries.filter((e) => !e.isDir && VIDEO_EXTENSIONS.has(extOf(e.name)))
    const subFiles = sres.entries.filter((e) => !e.isDir && SUBTITLE_EXTENSIONS.has(extOf(e.name)))

    // .idx 的伴生 .sub（pairVideos 已把它从配对中剔除，这里从原始列表找回，改名时成对处理）
    const companionOf = (idx: FileEntry) =>
      subFiles.find(
        (s) => extOf(s.name) === 'sub' && s.path !== idx.path && pairingKey(s.name) === pairingKey(idx.name)
      ) || null

    const pr = pairVideos(videos.value, subFiles)
    const newRows: RenameRow[] = []
    for (const g of pr.rows) {
      for (const s of g.subs) {
        newRows.push({
          sub: s,
          companionSub: extOf(s.name) === 'idx' ? companionOf(s) : null,
          videoPath: g.video.path,
          newName: deriveName(g.video.name, s.name),
          nameEdited: false,
          include: true,
          status: 'ready',
          error: '',
        })
      }
    }
    // 未匹配字幕也进表格：手动指定视频或直接填新名后即可改名
    for (const s of pr.unmatchedSubs) {
      newRows.push({
        sub: s,
        companionSub: extOf(s.name) === 'idx' ? companionOf(s) : null,
        videoPath: '',
        newName: '',
        nameEdited: false,
        include: true,
        status: 'unset',
        error: '',
      })
    }
    rows.value = newRows
    unmatchedVideos.value = pr.unmatchedVideos
    scanned.value = true
    refreshStatuses()
  } catch (e: any) {
    message.error(e.message)
  } finally {
    scanning.value = false
  }
}

// ---------- 执行 ----------
const execCount = computed(() => rows.value.filter((r) => r.include && r.status === 'ready').length)

async function submit() {
  // 每行一条主文件改名；.idx 行的伴生 .sub 追加一条，成对落盘
  const jobs: { row: RenameRow; kind: 'main' | 'companion'; from: string; to: string }[] = []
  for (const r of rows.value) {
    if (!r.include || r.status !== 'ready') continue
    const to = targetPathFor(r)
    jobs.push({ row: r, kind: 'main', from: r.sub.path, to })
    if (r.companionSub) {
      jobs.push({
        row: r,
        kind: 'companion',
        from: r.companionSub.path,
        to: joinName(dirOf(to), baseOf(leafOf(to)) + '.' + rawExt(r.companionSub.name)),
      })
    }
  }
  if (!jobs.length) {
    message.warning(t('srn.noTasks'))
    return
  }
  submitting.value = true
  try {
    const { results } = await api.renameSubs(
      jobs.map((j) => ({ from: j.from, to: j.to })),
      overwrite.value
    )
    // 结果按行归并：主文件与伴生都成功才算完成；任一失败行标失败并更新已落盘部分
    const byRow = new Map<RenameRow, { main?: RenameResult; companion?: RenameResult }>()
    results.forEach((res, i) => {
      const j = jobs[i]
      const rec = byRow.get(j.row) || {}
      rec[j.kind] = res
      byRow.set(j.row, rec)
    })
    let ok = 0
    let failed = 0
    for (const [r, rec] of byRow) {
      if (rec.main?.ok && (!r.companionSub || rec.companion?.ok)) {
        ok++
        r.status = 'done'
        r.error = ''
        r.sub = { ...r.sub, path: rec.main.to, name: leafOf(rec.main.to) }
        if (r.companionSub && rec.companion) {
          r.companionSub = { ...r.companionSub, path: rec.companion.to, name: leafOf(rec.companion.to) }
        }
      } else {
        failed++
        r.status = 'failed'
        r.error = rec.main?.ok ? rec.companion?.error || '' : rec.main?.error || ''
        if (rec.main?.ok) r.sub = { ...r.sub, path: rec.main.to, name: leafOf(rec.main.to) }
      }
    }
    refreshStatuses()
    if (ok) message.success(t('srn.doneOk', { n: ok }))
    if (failed) message.error(t('srn.doneFail', { n: failed }))
  } catch (e: any) {
    message.error(e.message)
  } finally {
    submitting.value = false
  }
}

// ---------- 状态标签 ----------
function tagType(s: RowStatus): 'default' | 'info' | 'success' | 'warning' | 'error' {
  if (s === 'ready') return 'info'
  if (s === 'done') return 'success'
  if (s === 'same') return 'default'
  if (s === 'failed') return 'error'
  return 'warning' // unset / conflict
}
const statusText = (s: RowStatus) =>
  t(
    {
      same: 'srn.stSame',
      ready: 'srn.stReady',
      unset: 'srn.stUnset',
      conflict: 'srn.stConflict',
      done: 'srn.stDone',
      failed: 'srn.stFailed',
    }[s]
  )

const videoOptions = computed(() => videos.value.map((v) => ({ label: v.name, value: v.path })))

// 语言后缀下拉：首项“不添加”+ 识别规则表中的常用后缀
const suffixOptions = computed(() => [
  { label: t('srn.suffixNone'), value: '' },
  ...LANG_SUFFIX_PRESETS.map((p) => ({ label: `${p.suffix}（${p.name}）`, value: p.suffix })),
])

// ---------- 草稿 ----------
const DRAFT_KEY = 'mkv.subrename'

onMounted(() => {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (draft) {
      videoDir.value = draft.videoDir || ''
      subDir.value = draft.subDir || ''
      keepLang.value = draft.keepLang !== false
      addSuffix.value = draft.addSuffix || '' // 与 keepLang 互斥由 watch 收敛，后设的 addSuffix 优先
      moveToVideo.value = !!draft.moveToVideo
      overwrite.value = !!draft.overwrite
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
      keepLang: keepLang.value,
      addSuffix: addSuffix.value,
      moveToVideo: moveToVideo.value,
      overwrite: overwrite.value,
    })
  )
}
watch([videoDir, subDir, keepLang, addSuffix, moveToVideo, overwrite], saveDraft)

// 切换"保留语言标记"/"添加语言后缀"（两者互斥，后选的生效）：重算未手改名字的行
function recomputeDerivedNames() {
  for (const r of rows.value) {
    if (r.nameEdited || r.status === 'done' || r.status === 'failed') continue
    const ve = videos.value.find((x) => x.path === r.videoPath)
    if (ve) r.newName = deriveName(ve.name, r.sub.name)
  }
  refreshStatuses()
}
watch(keepLang, (v) => {
  if (v && addSuffix.value) addSuffix.value = ''
  recomputeDerivedNames()
})
watch(addSuffix, (v) => {
  if (v && keepLang.value) keepLang.value = false
  recomputeDerivedNames()
})
// 切换"移动到视频目录"：目标目录变化，重算 same/冲突
watch(moveToVideo, refreshStatuses)
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('srn.dirs')">
      <NGrid :cols="2" :x-gap="12" :y-gap="12">
        <NGi>
          <div class="field-label">{{ $t('srn.videoDir') }}</div>
          <NInput :value="videoDir" readonly placeholder="/vol1/..." @click="openBrowser('videoDir')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('videoDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi>
          <div class="field-label">{{ $t('srn.subDir') }}</div>
          <NInput
            :value="subDir"
            readonly
            :placeholder="$t('srn.sameAsVideo')"
            @click="openBrowser('subDir')"
          >
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('subDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </NGi>
        <NGi :span="2">
          <NSpace>
            <NCheckbox v-model:checked="keepLang">{{ $t('srn.keepLang') }}</NCheckbox>
            <NCheckbox v-model:checked="moveToVideo">{{ $t('srn.moveToVideo') }}</NCheckbox>
            <NCheckbox v-model:checked="overwrite">{{ $t('srn.overwrite') }}</NCheckbox>
            <div class="suffix-picker">
              <span class="suffix-label">{{ $t('srn.addSuffix') }}</span>
              <NSelect
                v-model:value="addSuffix"
                :options="suffixOptions"
                size="small"
                style="width: 220px"
              />
            </div>
          </NSpace>
        </NGi>
      </NGrid>
      <div style="margin-top: 8px; font-size: 12px; opacity: 0.55">{{ $t('srn.dirsHint') }}</div>
      <div style="margin-top: 12px">
        <NButton type="primary" :loading="scanning" @click="scan">{{ $t('srn.scan') }}</NButton>
      </div>
    </NCard>

    <template v-if="scanned">
      <NCard :title="$t('srn.result', { n: rows.length })">
        <template #header-extra>
          <NPopconfirm @positive-click="submit">
            <template #trigger>
              <NButton type="primary" :loading="submitting" :disabled="execCount === 0">
                {{ $t('srn.exec', { n: execCount }) }}
              </NButton>
            </template>
            {{ $t('srn.confirmExec') }}
          </NPopconfirm>
        </template>
        <NAlert v-if="!rows.length" type="info" :show-icon="false">{{ $t('srn.noSubs') }}</NAlert>
        <NTable v-else size="small" :single-line="false" :bordered="false">
          <thead>
            <tr>
              <th style="width: 50px">{{ $t('srn.colInclude') }}</th>
              <th style="width: 26%">{{ $t('srn.colSub') }}</th>
              <th style="width: 26%">{{ $t('srn.colVideo') }}</th>
              <th>{{ $t('srn.colNew') }}</th>
              <th style="width: 110px">{{ $t('srn.colStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.sub.path">
              <td><NCheckbox v-model:checked="r.include" size="small" /></td>
              <td style="word-break: break-all; font-size: 12px" :title="r.sub.path">
                {{ r.sub.name }}
                <span v-if="r.companionSub" style="opacity: 0.6">（{{ $t('srn.withSub') }}）</span>
              </td>
              <td>
                <NSelect
                  :value="r.videoPath || null"
                  size="small"
                  filterable
                  clearable
                  :placeholder="$t('srn.pickVideo')"
                  :options="videoOptions"
                  @update:value="(v: string | null) => onVideoChange(r, v)"
                />
              </td>
              <td>
                <NInput
                  :value="r.newName"
                  size="small"
                  :placeholder="$t('srn.namePlaceholder')"
                  @update:value="(v: string) => onNameInput(r, v)"
                />
                <div v-if="moveToVideo && r.videoPath" class="target-dir">{{ targetDirFor(r) }}</div>
              </td>
              <td>
                <NTag size="small" :type="tagType(r.status)">{{ statusText(r.status) }}</NTag>
                <div v-if="r.error" class="err" :title="r.error">{{ r.error }}</div>
              </td>
            </tr>
          </tbody>
        </NTable>
        <div v-if="unmatchedVideos.length" style="margin-top: 8px; font-size: 12px; opacity: 0.6">
          {{ $t('srn.unmatchedVideos', { n: unmatchedVideos.length }) }}：{{ unmatchedVideos.map((v) => v.name).join('、') }}
        </div>
      </NCard>
    </template>

    <NSpin v-if="scanning" style="display: block; text-align: center; padding: 20px">{{ $t('common.loading') }}</NSpin>

    <FileBrowser v-model:show="browser" mode="dir" filter="media" @select="onBrowserSelect" />
  </NSpace>
</template>

<style scoped>
.field-label {
  margin-bottom: 4px;
  font-size: 13px;
  opacity: 0.7;
}
.suffix-picker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.suffix-label {
  font-size: 14px;
}
.target-dir {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.55;
  word-break: break-all;
}
.err {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.75;
  word-break: break-all;
}
</style>
