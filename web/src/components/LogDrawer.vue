<script setup lang="ts">
// 任务日志抽屉：运行中自动刷新
import { ref, watch, onUnmounted } from 'vue'
import { NDrawer, NDrawerContent } from 'naive-ui'
import { api, type Job } from '../api'

const props = defineProps<{ show: boolean; job: Job | null }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const log = ref('')
const timer = ref<number | null>(null)

async function loadLog() {
  if (!props.job) return
  try {
    const j = await api.getJob(props.job.id)
    log.value = j.log || ''
  } catch {
    /* ignore */
  }
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      loadLog()
      timer.value = window.setInterval(loadLog, 1500)
    } else if (timer.value) {
      clearInterval(timer.value)
      timer.value = null
    }
  }
)

onUnmounted(() => {
  if (timer.value) clearInterval(timer.value)
})
</script>

<template>
  <NDrawer :show="show" :width="640" @update:show="(v: boolean) => emit('update:show', v)">
    <NDrawerContent :title="`${job?.name ?? ''} — ${job?.id ?? ''}`" closable>
      <NSpace vertical size="small">
        <pre
          style="
            background: rgba(0, 0, 0, 0.35);
            padding: 12px;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.5;
            overflow: auto;
            max-height: 70vh;
            white-space: pre-wrap;
            word-break: break-all;
            margin: 0;
          "
        >{{ log || '…' }}</pre>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>
