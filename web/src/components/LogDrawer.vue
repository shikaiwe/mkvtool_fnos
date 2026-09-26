<script setup lang="ts">
// 任务日志抽屉：WS 实时追加（type:'log' 事件），WS 掉线时回退 3s 轮询
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { NDrawer, NDrawerContent, useThemeVars } from 'naive-ui'
import { api, type Job } from '../api'
import { onWsMessage, jobsState } from '../composables/jobs'

const props = defineProps<{ show: boolean; job: Job | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()
const tv = useThemeVars()

const log = ref('')
const timer = ref<number | null>(null)
const box = ref<HTMLElement | null>(null)
let offWs: (() => void) | null = null

async function loadLog() {
  if (!props.job) return
  try {
    const j = await api.getJob(props.job.id)
    log.value = j.log || ''
    follow()
  } catch {
    /* ignore */
  }
}

function follow() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  })
}

function onLine(id: string, line: string) {
  if (!props.show || !props.job || props.job.id !== id) return
  log.value += (log.value ? '\n' : '') + line
  follow()
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      loadLog()
      if (!offWs) {
        offWs = onWsMessage((msg) => {
          if (msg.type === 'log') onLine(msg.id, msg.line)
        })
      }
      if (!timer.value) {
        timer.value = window.setInterval(() => {
          if (!jobsState.connected) loadLog()
        }, 3000)
      }
    } else if (timer.value) {
      clearInterval(timer.value)
      timer.value = null
    }
  }
)

onUnmounted(() => {
  offWs?.()
  if (timer.value) clearInterval(timer.value)
})
</script>

<template>
  <NDrawer :show="show" :width="640" @update:show="(v: boolean) => emit('update:show', v)">
    <NDrawerContent :title="`${job?.name ?? ''} — ${job?.id ?? ''}`" closable>
      <NSpace vertical size="small">
        <pre
          ref="box"
          :style="{
            background: tv.actionColor,
            padding: '12px',
            borderRadius: '6px',
            fontSize: '12px',
            lineHeight: '1.5',
            overflow: 'auto',
            maxHeight: '70vh',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            margin: '0'
          }"
        >{{ log || '…' }}</pre>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>
