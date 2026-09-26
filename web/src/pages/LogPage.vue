<script setup lang="ts">
// 运行日志页：结构化条目（时间/级别/来源/消息）+ 级别与关键字过滤
// WS 实时追加（断线回退 5s 轮询）+ 跟随滚动 + 下载/清空
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NSpace, NSwitch, NButton, NInput, NSelect, NTag, NPopconfirm, useThemeVars, useMessage } from 'naive-ui'
import { api, BASE, type LogEntry } from '../api'
import { onWsMessage, jobsState, startJobsSync } from '../composables/jobs'

const { t } = useI18n()
const tv = useThemeVars()
const message = useMessage()

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
const MAX_ENTRIES = 5000

const entries = ref<LogEntry[]>([])
const logFile = ref('')
const auto = ref(true)
const level = ref<string>('')
const kw = ref('')
const loading = ref(false)
const box = ref<HTMLElement | null>(null)
let pollTimer: number | null = null
let offWs: (() => void) | null = null

const levelOptions = [{ label: 'ALL', value: '' }, ...LEVELS.map((l) => ({ label: l.toUpperCase(), value: l }))]

const visible = computed(() => {
  const min = level.value ? LEVELS.indexOf(level.value as any) : 0
  const k = kw.value.trim().toLowerCase()
  return entries.value.filter((e) => {
    if (min > 0 && LEVELS.indexOf(e.level) < min) return false
    if (k && !(`${e.msg} ${e.detail || ''}`.toLowerCase().includes(k))) return false
    return true
  })
})

const levelTagType = (l: string) =>
  (l === 'error' ? 'error' : l === 'warn' ? 'warning' : l === 'debug' ? 'default' : 'info') as
    | 'error'
    | 'warning'
    | 'default'
    | 'info'

function fmtTime(ts: string) {
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleTimeString('zh-CN', { hour12: false })
}

function follow() {
  if (!auto.value) return
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  })
}

// manual=true 仅用于用户点击刷新按钮：只有这时才显示按钮的加载动画，
// 初始加载与自动轮询/WS 兜底刷新一律静默，避免自动刷新时动画闪个不停
async function load(manual = false) {
  if (manual) loading.value = true
  try {
    const r = await api.logs(2000)
    entries.value = r.entries
    logFile.value = r.file
    follow()
  } catch {
    /* 下次轮询再试 */
  } finally {
    if (manual) loading.value = false
  }
}

function pushEntry(e: LogEntry) {
  if (!e || !e.ts) return
  entries.value.push(e)
  if (entries.value.length > MAX_ENTRIES) entries.value.splice(0, entries.value.length - MAX_ENTRIES)
  follow()
}

// WS 在线时实时追加；掉线时以 5s 轮询兜底
function syncPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (auto.value && !jobsState.connected) {
    pollTimer = window.setInterval(load, 5000)
  }
}

function toggleAuto(v: boolean) {
  auto.value = v
  if (v) syncPoll()
  else if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function download() {
  try {
    const res = await fetch(`${BASE}/api/logs/raw`)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'app.log'
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e: any) {
    message.error(e.message)
  }
}

async function clear() {
  try {
    await api.clearLogs()
    entries.value = []
    message.success(t('logs.cleared'))
  } catch (e: any) {
    message.error(e.message)
  }
}

onMounted(async () => {
  startJobsSync()
  await load()
  offWs = onWsMessage((msg) => {
    if (msg.type === 'applog') pushEntry(msg.entry)
  })
  syncPoll()
})

watch(() => jobsState.connected, syncPoll)

onUnmounted(() => {
  offWs?.()
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <NCard :title="$t('menu.logs')" style="height: 100%">
    <template #header-extra>
      <NSpace align="center">
        <NSelect v-model:value="level" :options="levelOptions" size="small" style="width: 110px" />
        <NInput v-model:value="kw" size="small" clearable :placeholder="$t('logs.search')" style="width: 200px" />
        <span style="font-size: 12px; opacity: 0.7">{{ $t('logs.autoRefresh') }}</span>
        <NSwitch :value="auto" size="small" @update:value="toggleAuto" />
        <NButton size="small" :loading="loading" @click="load(true)">{{ $t('common.refresh') }}</NButton>
        <NButton size="small" @click="download">{{ $t('logs.download') }}</NButton>
        <NPopconfirm @positive-click="clear">
          <template #trigger>
            <NButton size="small" quaternary type="error">{{ $t('logs.clear') }}</NButton>
          </template>
          {{ $t('logs.clearConfirm') }}
        </NPopconfirm>
      </NSpace>
    </template>
    <div
      ref="box"
      :style="{
        background: tv.actionColor,
        borderRadius: '6px',
        padding: '12px',
        height: 'calc(100vh - 230px)',
        overflow: 'auto',
      }"
    >
      <div
        v-for="(e, i) in visible"
        :key="i + e.ts"
        :style="{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: '12px',
          lineHeight: '1.6',
          padding: '1px 0',
          borderBottom: `1px solid ${tv.dividerColor}`,
          opacity: e.level === 'debug' ? 0.65 : 1,
        }"
      >
        <div style="display: flex; gap: 8px; align-items: baseline">
          <span style="opacity: 0.55; flex-shrink: 0">{{ fmtTime(e.ts) }}</span>
          <NTag :type="levelTagType(e.level)" size="tiny" :bordered="false" style="flex-shrink: 0; width: 52px; justify-content: center">
            {{ e.level.toUpperCase() }}
          </NTag>
          <NTag size="tiny" :bordered="false" style="flex-shrink: 0; opacity: 0.75">{{ e.scope }}</NTag>
          <span style="white-space: pre-wrap; word-break: break-all; min-width: 0">{{ e.msg }}</span>
        </div>
        <pre
          v-if="e.detail"
          :style="{ margin: '2px 0 4px 0', paddingLeft: '90px', fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.6 }"
        >{{ e.detail }}</pre>
      </div>
      <div v-if="!visible.length" style="opacity: 0.5; padding: 12px">{{ $t('logs.empty') }}</div>
    </div>
    <div style="margin-top: 8px; font-size: 12px; opacity: 0.6">
      {{ $t('logs.hint', { n: visible.length, file: logFile }) }}
    </div>
  </NCard>
</template>
