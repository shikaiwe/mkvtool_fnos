<script setup lang="ts">
// 混流页：以「内封字幕」为主用途的三个模式。
// 快速内封 = 单视频+多字幕；批量内封 = 目录扫描自动配对；高级混流 = 完整轨道编辑（原混流页）。
import { ref, watch } from 'vue'
import { NTabs, NTabPane } from 'naive-ui'
import QuickSubMux from '../components/QuickSubMux.vue'
import BatchSubMux from '../components/BatchSubMux.vue'
import AdvancedMux from '../components/AdvancedMux.vue'

const tab = ref(localStorage.getItem('mkv.muxTab') || 'quick')
watch(tab, (v) => localStorage.setItem('mkv.muxTab', v))
</script>

<template>
  <NTabs v-model:value="tab" type="line" size="large">
    <NTabPane name="quick" :tab="$t('muxer.tabQuick')">
      <QuickSubMux />
    </NTabPane>
    <NTabPane name="batch" :tab="$t('muxer.tabBatch')">
      <BatchSubMux />
    </NTabPane>
    <NTabPane name="advanced" :tab="$t('muxer.tabAdvanced')">
      <AdvancedMux />
    </NTabPane>
  </NTabs>
</template>
