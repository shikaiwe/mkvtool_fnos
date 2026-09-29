<script setup lang="ts">
// 提取页：mkvextract 全模式，支持批量添加源文件（每个文件一个任务）。
// 输出目录留空 = 各源文件所在目录；设置页默认输出目录优先。
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NSpace, NButton, NInput, NTag, NAlert, NCollapse, NCollapseItem, NPopconfirm, useMessage,
} from 'naive-ui'
import { api } from '../api'
import FileBrowser from '../components/FileBrowser.vue'
import ExtractFileCard from '../components/ExtractFileCard.vue'
import { baseOf, buildArgv, defaultExt, makeItem, type ExtractItem } from '../extract'

const { t } = useI18n()
const message = useMessage()

const items = ref<ExtractItem[]>([])
const outDir = ref('')

const browser = ref(false)
const browserFor = ref<'src' | 'outDir'>('src')

function openBrowser(which: 'src' | 'outDir') {
  browserFor.value = which
  browser.value = true
}

function onBrowserSelect(p: string) {
  if (browserFor.value === 'outDir') outDir.value = p
}

function onBrowserSelectMulti(paths: string[]) {
  addFiles(paths)
}

async function addFiles(paths: string[]) {
  const queue = paths
    .filter((p) => !items.value.some((i) => i.path === p))
    .map((p) => {
      // 先包成 reactive 再入列：后续用局部引用改 status/ident 必须走代理，否则 UI 不更新
      const it = reactive(makeItem(p))
      items.value.push(it)
      return it
    })
  // 识别并发限制在 3，一次添加大量文件时不打爆后端
  let idx = 0
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (idx < queue.length) {
        const it = queue[idx++]
        try {
          it.ident = await api.identify(it.path)
          const base = baseOf(it.path).replace(/\.[^.]+$/, '')
          for (const tr of it.ident?.tracks || []) {
            it.trackSel[tr.id] = false
            it.tsSel[tr.id] = false
            it.trackOut[tr.id] = `${base}.track${tr.id}.${defaultExt(tr)}`
          }
          for (const a of it.ident?.attachments || []) it.attachSel[a.id] = false
          it.status = 'ready'
        } catch (e: any) {
          it.error = e.message
          it.status = 'error'
        }
      }
    })
  )
}

function removeItem(it: ExtractItem) {
  items.value = items.value.filter((i) => i !== it)
}

const submittable = computed(() => items.value.filter((i) => buildArgv(i, outDir.value)))

const submitLabel = computed(() =>
  submittable.value.length ? t('extract.submitCount', { n: submittable.value.length }) : t('common.submit')
)

async function submit() {
  if (!submittable.value.length) {
    message.warning(t('extract.pickSomething'))
    return
  }
  let ok = 0
  let fail = 0
  for (const it of submittable.value) {
    try {
      await api.createJob({ name: `extract ${baseOf(it.path)}`, tool: 'mkvextract', argv: buildArgv(it, outDir.value)! })
      ok++
    } catch (e: any) {
      fail++
      message.error(`${baseOf(it.path)}: ${e.message}`)
    }
  }
  if (ok) message.success(t('extract.submittedCount', { n: ok }))
  if (fail) message.error(t('extract.submitFailed', { n: fail }))
}

onMounted(async () => {
  try {
    const s = await api.settings()
    if (s.defaultOutputDir) outDir.value = s.defaultOutputDir
  } catch {
    /* ignore */
  }
})

// 一键清空：回到初始状态（文件列表/输出目录全部重置）
function clearAll() {
  items.value = []
  outDir.value = ''
}
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('extract.title')">
      <template #header-extra>
        <NPopconfirm @positive-click="clearAll">
          <template #trigger>
            <NButton quaternary type="error" size="small">{{ $t('common.clearAll') }}</NButton>
          </template>
          {{ $t('common.clearAllConfirm') }}
        </NPopconfirm>
      </template>
      <NSpace vertical size="small">
        <div style="display: flex; gap: 8px; align-items: center">
          <NTag size="small">{{ $t('extract.source') }}</NTag>
          <NButton size="small" @click="openBrowser('src')">{{ $t('extract.addFiles') }}</NButton>
          <NTag size="small">{{ $t('extract.outputDir') }}</NTag>
          <NInput :value="outDir" readonly :placeholder="$t('extract.outDirHint')" @click="openBrowser('outDir')">
            <template #suffix>
              <NButton quaternary size="tiny" @click.stop="openBrowser('outDir')">{{ $t('common.browse') }}</NButton>
            </template>
          </NInput>
        </div>
        <div style="font-size: 12px; opacity: 0.65">{{ $t('extract.outDirHint') }}</div>
      </NSpace>
    </NCard>

    <NCard v-if="items.length" :title="$t('extract.fileList')">
      <NSpace vertical size="large">
        <NCollapse>
          <NCollapseItem v-for="it in items" :key="it.path" :name="it.path">
            <template #header>
              <span :title="it.path" style="font-size: 13px; word-break: break-all">{{ baseOf(it.path) }}</span>
            </template>
            <template #header-extra>
              <span style="display: inline-flex; gap: 6px; align-items: center" @click.stop>
                <NTag v-if="it.status === 'identifying'" size="tiny" :bordered="false">{{ $t('extract.stIdentifying') }}</NTag>
                <NTag v-else-if="it.status === 'error'" size="tiny" type="error" :bordered="false" :title="it.error">
                  {{ $t('extract.stFailed') }}
                </NTag>
                <NButton quaternary type="error" size="tiny" @click.stop="removeItem(it)">{{ $t('common.remove') }}</NButton>
              </span>
            </template>
            <NAlert v-if="it.status === 'error'" type="error" :show-icon="false">{{ it.error }}</NAlert>
            <ExtractFileCard v-else-if="it.status === 'ready'" :item="it" :out-dir="outDir" />
          </NCollapseItem>
        </NCollapse>
        <NButton type="primary" :disabled="!submittable.length" @click="submit">{{ submitLabel }}</NButton>
      </NSpace>
    </NCard>
    <NAlert v-else type="info" :show-icon="false">{{ $t('extract.emptyFiles') }}</NAlert>

    <FileBrowser
      v-model:show="browser"
      :mode="browserFor === 'src' ? 'file' : 'dir'"
      :filter="browserFor === 'src' ? 'media' : ''"
      :multi="browserFor === 'src'"
      @select="onBrowserSelect"
      @select-multi="onBrowserSelectMulti"
    />
  </NSpace>
</template>
