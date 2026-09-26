<script setup lang="ts">
// 文件/目录选择器：以服务端授权目录为根的受控浏览
// 侧栏（根目录 + 最近） + 面包屑 + 搜索 + 列表/网格视图；颜色全部取自当前主题，深浅色自适应
import { ref, watch, computed, h, defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NButton, NInput, NSpin, useThemeVars } from 'naive-ui'
import { api, fmtSize, type FileEntry, type Root } from '../api'

const props = withDefaults(
  defineProps<{
    show: boolean
    mode?: 'file' | 'dir'
    filter?: '' | 'media'
    multi?: boolean
    title?: string
    initialPath?: string
  }>(),
  { mode: 'file', filter: '', multi: false, title: '', initialPath: '' }
)
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'select', path: string): void
  (e: 'select-multi', paths: string[]): void
}>()

const { t } = useI18n()
const tv = useThemeVars()

// ---------- 内联 SVG 图标（Feather 风格描边） ----------
const ICON_PATHS: Record<string, string> = {
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  video: '<path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  subtitle:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  archive:
    '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  drive:
    '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  up: '<polyline points="14 9 9 4 4 9"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  refresh:
    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
}
const FbIcon = defineComponent({
  props: { name: { type: String, required: true } },
  setup(ic) {
    return () =>
      h('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        class: 'fb-ic',
        innerHTML: ICON_PATHS[ic.name] || ICON_PATHS.file,
      })
  },
})

// ---------- 类型图标 ----------
const VIDEO_EXT = new Set(['mp4', 'mkv', 'mks', 'mk3d', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm2ts', 'mts', 'ts', 'mpg', 'mpeg', 'ogv', 'rmvb', 'rm', '3gp', 'm4v', 'vob', 'f4v'])
const AUDIO_EXT = new Set(['mp3', 'aac', 'flac', 'wav', 'ogg', 'm4a', 'opus', 'dts', 'wma', 'ape', 'ac3', 'mka', 'eac3', 'thd', 'dtshd', 'truehd', 'cue'])
const SUB_EXT = new Set(['srt', 'ass', 'ssa', 'sub', 'idx', 'sup', 'vtt', 'smi', 'mpl'])
const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico'])
const ARC_EXT = new Set(['zip', 'rar', '7z', 'gz', 'xz', 'bz2', 'zst', 'iso', 'tar', 'xml'])

function iconFor(e: FileEntry): string {
  if (e.isDir) return 'folder'
  const ext = e.name.split('.').pop()?.toLowerCase() || ''
  if (VIDEO_EXT.has(ext)) return 'video'
  if (SUB_EXT.has(ext)) return 'subtitle'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (IMG_EXT.has(ext)) return 'image'
  if (ARC_EXT.has(ext)) return 'archive'
  return 'file'
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- 状态 ----------
const path = ref('')
const parent = ref('')
const entries = ref<FileEntry[]>([])
const roots = ref<Root[]>([])
const loading = ref(false)
const selected = ref('')
const selectedDir = ref('')
const multiSelected = ref<string[]>([])
const error = ref('')
const search = ref('')
const view = ref<'list' | 'grid'>(
  (localStorage.getItem('mkv.fbView') === 'grid' ? 'grid' : 'list') as 'list' | 'grid'
)

const RECENT_KEY = 'mkv.recentDirs'
const recentDirs = ref<string[]>([])
try {
  const saved: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  if (Array.isArray(saved)) recentDirs.value = saved.filter((x): x is string => typeof x === 'string')
} catch {
  /* ignore */
}
function rememberRecent(p: string) {
  if (!p) return
  recentDirs.value = [p, ...recentDirs.value.filter((x) => x !== p)].slice(0, 8)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentDirs.value))
  } catch {
    /* ignore */
  }
}

const filteredEntries = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter((e) => e.name.toLowerCase().includes(q))
})

const crumbs = computed(() => {
  const parts = path.value.split(/[\\/]+/).filter(Boolean)
  const list: { name: string; path: string }[] = []
  if (/^[A-Za-z]:$/.test(parts[0] || '')) {
    list.push({ name: parts[0], path: parts[0] + '\\' })
    let rest = parts[0] + '\\'
    for (let i = 1; i < parts.length; i++) {
      rest = rest.replace(/\\$/, '') + '\\' + parts[i]
      list.push({ name: parts[i], path: rest })
    }
  } else {
    list.push({ name: '/', path: '/' })
    let acc = ''
    for (const p of parts) {
      acc += '/' + p
      list.push({ name: p, path: acc })
    }
  }
  return list
})

const rootValue = computed(() => roots.value.find((r) => path.value.startsWith(r.path))?.path || null)

function fmtName(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p
}

async function load(p?: string) {
  loading.value = true
  error.value = ''
  selected.value = ''
  selectedDir.value = ''
  search.value = ''
  try {
    const data = await api.files(p || '', (props.filter || undefined) as any)
    if (!p && data.roots.length && !data.path) {
      roots.value = data.roots
      return load(data.roots[0].path)
    }
    path.value = data.path
    parent.value = data.parent
    entries.value = data.entries
    roots.value = data.roots
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      multiSelected.value = []
      load(props.initialPath || '')
    }
  }
)

// ---------- 交互 ----------
function open(e: FileEntry) {
  if (e.isDir) load(e.path)
  else selected.value = e.path
}

function toggleMulti(e: FileEntry) {
  const i = multiSelected.value.indexOf(e.path)
  if (i >= 0) multiSelected.value.splice(i, 1)
  else multiSelected.value.push(e.path)
}

function clickRow(e: FileEntry) {
  if (props.multi && !e.isDir) return toggleMulti(e)
  if (props.mode === 'dir' && e.isDir) return (selectedDir.value = e.path)
  open(e)
}

function dblClickRow(e: FileEntry) {
  if (props.multi && !e.isDir) return
  if (props.mode === 'dir' && e.isDir) {
    selectedDir.value = ''
    load(e.path)
    return
  }
  open(e)
}

function isPicked(e: FileEntry) {
  if (props.multi) return multiSelected.value.includes(e.path)
  if (props.mode === 'dir') return selectedDir.value === e.path
  return selected.value === e.path
}

const canConfirm = computed(() =>
  props.mode === 'dir' ? !!path.value : props.multi ? multiSelected.value.length > 0 : !!selected.value
)
const confirmLabel = computed(() => {
  if (props.mode === 'dir') return selectedDir.value ? t('browser.chooseDirName', { name: fmtName(selectedDir.value) }) : t('browser.currentDir')
  if (props.multi) return multiSelected.value.length ? t('browser.pickedCount', { n: multiSelected.value.length }) : t('common.add')
  return t('browser.selectFile')
})

function confirm() {
  if (props.mode === 'dir') {
    const p = selectedDir.value || path.value
    if (!p) return
    rememberRecent(p)
    emit('select', p)
  } else if (props.multi) {
    if (!multiSelected.value.length) return
    rememberRecent(path.value)
    emit('select-multi', [...multiSelected.value])
  } else {
    if (!selected.value) return
    rememberRecent(path.value)
    emit('select', selected.value)
  }
  emit('update:show', false)
}

function setView(v: 'list' | 'grid') {
  view.value = v
  try {
    localStorage.setItem('mkv.fbView', v)
  } catch {
    /* ignore */
  }
}

// ---------- 主题变量 ----------
const cssVars = computed(() => ({
  '--fb-modal': tv.value.modalColor,
  '--fb-border': tv.value.dividerColor,
  '--fb-hover': tv.value.hoverColor,
  '--fb-side': tv.value.actionColor,
  '--fb-text': tv.value.textColor1,
  '--fb-text2': tv.value.textColor2,
  '--fb-text3': tv.value.textColor3,
  '--fb-primary': tv.value.primaryColor,
}))
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => emit('update:show', v)">
    <div class="fb-root" :style="cssVars">
      <div class="fb-header">
        <FbIcon :name="mode === 'dir' ? 'folder' : 'file'" class="fb-header-ic" />
        <span class="fb-title">{{ title || (mode === 'dir' ? $t('browser.selectDir') : $t('browser.selectFile')) }}</span>
        <button class="fb-icon-btn" :title="$t('common.cancel')" @click="emit('update:show', false)">
          <FbIcon name="x" />
        </button>
      </div>

      <div class="fb-body">
        <aside class="fb-side">
          <div class="fb-side-title">{{ $t('browser.roots') }}</div>
          <div
            v-for="r in roots"
            :key="r.path"
            class="fb-side-item"
            :class="{ active: rootValue === r.path }"
            :title="r.path"
            @click="load(r.path)"
          >
            <FbIcon name="drive" class="fb-side-ic" />
            <div class="fb-side-txt">
              <div class="fb-side-name">{{ r.label || fmtName(r.path) }}</div>
              <div class="fb-side-path">{{ r.path }}</div>
            </div>
          </div>
          <template v-if="recentDirs.length">
            <div class="fb-side-title">{{ $t('browser.recent') }}</div>
            <div v-for="p in recentDirs" :key="p" class="fb-side-item" :title="p" @click="load(p)">
              <FbIcon name="clock" class="fb-side-ic" />
              <div class="fb-side-txt">
                <div class="fb-side-name">{{ fmtName(p) }}</div>
                <div class="fb-side-path">{{ p }}</div>
              </div>
            </div>
          </template>
        </aside>

        <section class="fb-main">
          <div class="fb-toolbar">
            <button class="fb-icon-btn" :disabled="!parent" :title="$t('browser.up')" @click="load(parent)">
              <FbIcon name="up" />
            </button>
            <div class="fb-crumbs">
              <template v-if="path">
                <template v-for="(c, i) in crumbs" :key="c.path">
                  <span v-if="i" class="fb-crumb-sep">/</span>
                  <span
                    class="fb-crumb"
                    :class="{ last: i === crumbs.length - 1 }"
                    :title="c.path"
                    @click="i < crumbs.length - 1 && load(c.path)"
                  >{{ c.name }}</span>
                </template>
              </template>
            </div>
            <NInput v-model:value="search" size="small" round clearable :placeholder="$t('browser.search')" class="fb-search">
              <template #prefix><FbIcon name="search" class="fb-search-ic" /></template>
            </NInput>
            <div class="fb-seg">
              <button :class="{ on: view === 'list' }" :title="$t('browser.viewList')" @click="setView('list')">
                <FbIcon name="list" />
              </button>
              <button :class="{ on: view === 'grid' }" :title="$t('browser.viewGrid')" @click="setView('grid')">
                <FbIcon name="grid" />
              </button>
            </div>
            <button class="fb-icon-btn" :title="$t('common.refresh')" @click="load(path)">
              <FbIcon name="refresh" />
            </button>
          </div>

          <NSpin :show="loading" class="fb-spin">
            <div class="fb-content">
              <template v-if="view === 'list'">
                <div
                  v-for="e in filteredEntries"
                  :key="e.path"
                  class="fb-row"
                  :class="{ sel: isPicked(e) }"
                  @click="clickRow(e)"
                  @dblclick="dblClickRow(e)"
                >
                  <FbIcon :name="iconFor(e)" class="fb-row-ic" :class="{ dir: e.isDir }" />
                  <span class="fb-row-name" :title="e.name">{{ e.name }}</span>
                  <span v-if="multi && !e.isDir && multiSelected.includes(e.path)" class="fb-check">
                    <FbIcon name="check" />
                  </span>
                  <span v-else-if="mode === 'dir' && e.isDir && selectedDir === e.path" class="fb-check">
                    <FbIcon name="check" />
                  </span>
                  <span class="fb-row-time">{{ e.isDir ? '' : fmtDate(e.mtimeMs) }}</span>
                  <span class="fb-row-size">{{ e.isDir ? '' : fmtSize(e.size) }}</span>
                </div>
              </template>
              <template v-else>
                <div class="fb-grid">
                  <div
                    v-for="e in filteredEntries"
                    :key="e.path"
                    class="fb-cell"
                    :class="{ sel: isPicked(e) }"
                    :title="e.name"
                    @click="clickRow(e)"
                    @dblclick="dblClickRow(e)"
                  >
                    <FbIcon :name="iconFor(e)" class="fb-cell-ic" :class="{ dir: e.isDir }" />
                    <span class="fb-cell-name">{{ e.name }}</span>
                    <span v-if="isPicked(e)" class="fb-check fb-check-cell"><FbIcon name="check" /></span>
                  </div>
                </div>
              </template>

              <div v-if="!loading && !filteredEntries.length" class="fb-empty">
                <FbIcon :name="error ? 'alert' : 'folder'" class="fb-empty-ic" />
                <div class="fb-empty-text">{{ error || $t('common.empty') }}</div>
                <NButton v-if="error" size="small" @click="load(path)">{{ $t('browser.retry') }}</NButton>
              </div>
            </div>
          </NSpin>
        </section>
      </div>

      <div class="fb-footer">
        <div class="fb-footer-info">
          <template v-if="mode === 'dir'">
            <FbIcon name="folder" class="fb-footer-ic" />
            <span class="fb-path" :title="selectedDir || path">{{ selectedDir ? fmtName(selectedDir) : path }}</span>
          </template>
          <template v-else-if="multi && multiSelected.length">
            <FbIcon name="check" class="fb-footer-ic" />
            <span>{{ $t('browser.pickedCount', { n: multiSelected.length }) }}</span>
          </template>
          <template v-else-if="selected">
            <FbIcon name="file" class="fb-footer-ic" />
            <span class="fb-path" :title="selected">{{ fmtName(selected) }}</span>
          </template>
        </div>
        <div class="fb-flex" />
        <NButton size="small" @click="emit('update:show', false)">{{ $t('common.cancel') }}</NButton>
        <NButton size="small" type="primary" :disabled="!canConfirm" @click="confirm">{{ confirmLabel }}</NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.fb-root {
  width: 880px;
  max-width: 96vw;
  background: var(--fb-modal);
  border-radius: 12px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  font-size: 13px;
}
.fb-flex {
  flex: 1;
}

/* ---------- 头部 ---------- */
.fb-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 12px 18px;
}
.fb-header-ic {
  width: 16px;
  height: 16px;
  color: var(--fb-primary);
}
.fb-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fb-text);
}

/* ---------- 图标按钮 / 分段控件 ---------- */
.fb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fb-text2);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}
.fb-icon-btn:hover:not(:disabled) {
  background: var(--fb-hover);
  color: var(--fb-text);
}
.fb-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.fb-icon-btn :deep(.fb-ic) {
  width: 14px;
  height: 14px;
}
.fb-seg {
  display: inline-flex;
  border: 1px solid var(--fb-border);
  border-radius: 6px;
  overflow: hidden;
}
.fb-seg button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--fb-text3);
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}
.fb-seg button + button {
  border-left: 1px solid var(--fb-border);
}
.fb-seg button:hover {
  background: var(--fb-hover);
}
.fb-seg button.on {
  background: var(--fb-hover);
  color: var(--fb-primary);
}
.fb-seg :deep(.fb-ic) {
  width: 13px;
  height: 13px;
}

/* ---------- 布局 ---------- */
.fb-body {
  display: flex;
  height: 480px;
  border-top: 1px solid var(--fb-border);
  border-bottom: 1px solid var(--fb-border);
}
.fb-side {
  width: 212px;
  flex: none;
  overflow-y: auto;
  padding: 10px 8px;
  background: var(--fb-side);
  border-right: 1px solid var(--fb-border);
}
.fb-side-title {
  font-size: 11px;
  color: var(--fb-text3);
  padding: 4px 8px 6px;
  letter-spacing: 0.5px;
}
.fb-side-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.fb-side-item:hover {
  background: var(--fb-hover);
}
.fb-side-item.active {
  background: color-mix(in srgb, var(--fb-primary) 14%, transparent);
  color: var(--fb-primary);
}
.fb-side-ic {
  width: 15px;
  height: 15px;
  flex: none;
}
.fb-side-txt {
  min-width: 0;
}
.fb-side-name {
  font-size: 12.5px;
  color: var(--fb-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fb-side-item.active .fb-side-name {
  color: var(--fb-primary);
  font-weight: 600;
}
.fb-side-path {
  font-size: 11px;
  color: var(--fb-text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* ---------- 工具栏 ---------- */
.fb-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 8px;
}
.fb-crumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  white-space: nowrap;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--fb-side);
  scrollbar-width: none;
}
.fb-crumbs::-webkit-scrollbar {
  display: none;
}
.fb-crumb {
  cursor: pointer;
  color: var(--fb-text2);
  flex: none;
}
.fb-crumb:hover {
  color: var(--fb-primary);
}
.fb-crumb.last {
  color: var(--fb-text);
  font-weight: 600;
  cursor: default;
}
.fb-crumb-sep {
  color: var(--fb-text3);
  flex: none;
}
.fb-search {
  width: 168px;
  flex: none;
}
.fb-search :deep(.fb-ic) {
  width: 13px;
  height: 13px;
}

/* ---------- 文件区 ---------- */
.fb-spin {
  flex: 1;
  min-height: 0;
}
.fb-spin :deep(.n-spin-container),
.fb-spin :deep(.n-spin-content) {
  height: 100%;
}
.fb-content {
  height: 100%;
  overflow-y: auto;
  padding: 2px 8px 10px;
  display: flex;
  flex-direction: column;
}
.fb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}
.fb-row:hover {
  background: var(--fb-hover);
}
.fb-row.sel {
  background: color-mix(in srgb, var(--fb-primary) 14%, transparent);
}
.fb-row-ic {
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--fb-text3);
}
.fb-row-ic.dir {
  color: var(--fb-primary);
}
.fb-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fb-text);
}
.fb-row-time {
  flex: none;
  font-size: 11.5px;
  color: var(--fb-text3);
  width: 118px;
  text-align: right;
}
.fb-row-size {
  flex: none;
  font-size: 11.5px;
  color: var(--fb-text3);
  width: 64px;
  text-align: right;
}
.fb-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border-radius: 50%;
  background: var(--fb-primary);
  color: #fff;
}
.fb-check :deep(.fb-ic) {
  width: 10px;
  height: 10px;
}

/* ---------- 网格视图 ---------- */
.fb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 4px;
  padding-top: 4px;
}
.fb-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s;
}
.fb-cell:hover {
  background: var(--fb-hover);
}
.fb-cell.sel {
  background: color-mix(in srgb, var(--fb-primary) 14%, transparent);
}
.fb-cell-ic {
  width: 34px;
  height: 34px;
  color: var(--fb-text3);
}
.fb-cell-ic.dir {
  color: var(--fb-primary);
}
.fb-cell-name {
  font-size: 12px;
  line-height: 1.35;
  max-height: 2.7em;
  overflow: hidden;
  word-break: break-all;
  text-align: center;
  color: var(--fb-text);
}
.fb-check-cell {
  position: absolute;
  top: 6px;
  right: 6px;
}

/* ---------- 空状态 ---------- */
.fb-empty {
  flex: 1;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--fb-text3);
}
.fb-empty-ic {
  width: 40px;
  height: 40px;
  opacity: 0.5;
}
.fb-empty-text {
  font-size: 13px;
}

/* ---------- 底部 ---------- */
.fb-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
}
.fb-footer-info {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fb-text2);
  font-size: 12px;
  min-width: 0;
}
.fb-footer-ic {
  width: 13px;
  height: 13px;
  flex: none;
  color: var(--fb-primary);
}
.fb-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 480px;
}
</style>
