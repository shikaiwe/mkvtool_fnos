<script setup lang="ts">
// 文件/目录选择器：以服务端授权目录为根的受控浏览
import { ref, watch, computed } from 'vue'
import { NModal, NButton, NInput, NSpin, NSpace, NBreadcrumb, NBreadcrumbItem, NTag, NSelect } from 'naive-ui'
import { api, fmtSize, type FileEntry, type Root } from '../api'

const props = withDefaults(
  defineProps<{
    show: boolean
    mode?: 'file' | 'dir'
    filter?: '' | 'media'
    title?: string
    initialPath?: string
  }>(),
  { mode: 'file', filter: '', title: '', initialPath: '' }
)
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'select', path: string): void
}>()

const path = ref('')
const parent = ref('')
const entries = ref<FileEntry[]>([])
const roots = ref<Root[]>([])
const loading = ref(false)
const selected = ref('')
const error = ref('')

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
const rootOptions = computed(() => roots.value.map((r) => ({ label: `${r.path} (${r.label})`, value: r.path })))

async function load(p?: string) {
  loading.value = true
  error.value = ''
  selected.value = ''
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
    if (v) load(props.initialPath || '')
  }
)

function open(e: FileEntry) {
  if (e.isDir) load(e.path)
  else selected.value = e.path
}

function confirm() {
  const target = props.mode === 'dir' ? path.value : selected.value
  if (!target) return
  emit('select', target)
  emit('update:show', false)
}

function fmtName(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p
}

function rowStyle(e: FileEntry) {
  const base = 'display:flex;align-items:center;gap:8px;padding:4px 10px;cursor:pointer'
  return selected.value === e.path ? base + ';background:rgba(99,102,241,0.25)' : base
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="(v: boolean) => emit('update:show', v)"
    :title="title || (mode === 'dir' ? $t('browser.selectDir') : $t('browser.selectFile'))"
    preset="card"
    style="width: 720px; max-width: 95vw"
  >
    <NSpace vertical size="small">
      <div style="display: flex; gap: 8px; align-items: center">
        <NSelect
          size="small"
          style="width: 200px"
          placeholder="root"
          :value="rootValue"
          :options="rootOptions"
          @update:value="(v: string) => load(v)"
        />
        <NButton size="small" :disabled="!parent" @click="load(parent)">{{ $t('browser.up') }}</NButton>
        <NInput v-model:value="path" size="small" placeholder="/vol1/..." @keyup.enter="load(path)" style="flex: 1" />
        <NButton size="small" @click="load(path)">{{ $t('common.refresh') }}</NButton>
      </div>

      <NBreadcrumb v-if="path">
        <NBreadcrumbItem v-for="c in crumbs" :key="c.path">
          <a style="cursor: pointer" @click="load(c.path)">{{ c.name }}</a>
        </NBreadcrumbItem>
      </NBreadcrumb>

      <NSpin :show="loading">
        <div style="height: 340px; overflow: auto; border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px">
          <div v-for="e in entries" :key="e.path" :style="rowStyle(e)" @click="e.isDir ? open(e) : (selected = e.path)" @dblclick="open(e)">
            <span>{{ e.isDir ? '📁' : '📄' }}</span>
            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ e.name }}</span>
            <span style="opacity: 0.6; font-size: 12px">{{ e.isDir ? '' : fmtSize(e.size) }}</span>
          </div>
          <div v-if="!loading && !entries.length" style="text-align: center; padding: 40px; opacity: 0.5">
            {{ error || $t('common.empty') }}
          </div>
        </div>
      </NSpin>

      <div style="display: flex; gap: 8px; align-items: center">
        <NTag v-if="selected" size="small" type="info">{{ fmtName(selected) }}</NTag>
        <div style="flex: 1" />
        <NButton @click="emit('update:show', false)">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :disabled="mode === 'dir' ? !path : !selected" @click="confirm">
          {{ mode === 'dir' ? $t('browser.selectDir') : $t('browser.selectFile') }}
        </NButton>
      </div>
    </NSpace>
  </NModal>
</template>
