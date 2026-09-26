<script setup lang="ts">
// 运行日志页：轮询 /api/logs 尾部行，自动刷新并跟随滚动到底部。
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NSpace, NSwitch, NButton, useThemeVars } from 'naive-ui'
import { api } from '../api'

const { t } = useI18n()
const tv = useThemeVars()

const lines = ref<string[]>([])
const logFile = ref('')
const auto = ref(true)
const loading = ref(false)
let timer: number | null = null
const box = ref<HTMLElement | null>(null)

const text = computed(() => lines.value.join('\n') || t('logs.empty'))

async function load() {
  loading.value = true
  try {
    const r = await api.logs(1000)
    lines.value = r.lines
    logFile.value = r.file
    if (auto.value) {
      await nextTick()
      if (box.value) box.value.scrollTop = box.value.scrollHeight
    }
  } catch {
    /* 下次轮询再试 */
  } finally {
    loading.value = false
  }
}

function toggleAuto(v: boolean) {
  auto.value = v
  if (v) {
    load()
    timer = window.setInterval(load, 3000)
  } else if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => toggleAuto(true))
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <NCard :title="$t('menu.logs')" style="height: 100%">
    <template #header-extra>
      <NSpace align="center">
        <span style="font-size: 12px; opacity: 0.7">{{ $t('logs.autoRefresh') }}</span>
        <NSwitch :value="auto" size="small" @update:value="toggleAuto" />
        <NButton size="small" :loading="loading" @click="load">{{ $t('common.refresh') }}</NButton>
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
      <pre
        :style="{
          margin: '0',
          fontSize: '12px',
          lineHeight: '1.6',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }"
      >{{ text }}</pre>
    </div>
    <div style="margin-top: 8px; font-size: 12px; opacity: 0.6">
      {{ $t('logs.hint', { n: lines.length, file: logFile }) }}
    </div>
  </NCard>
</template>
