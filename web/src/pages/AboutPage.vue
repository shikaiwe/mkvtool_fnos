<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NCard, NSpace, NTag, NAlert, NTable } from 'naive-ui'
import { api, type SystemInfo } from '../api'

const sys = ref<SystemInfo | null>(null)
onMounted(async () => {
  try {
    sys.value = await api.system()
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <NSpace vertical size="large">
    <NCard :title="$t('about.title')">
      <NSpace vertical size="small">
        <p style="margin: 0">{{ $t('about.desc') }}</p>
        <NTable v-if="sys" size="small" :single-line="false" :bordered="false">
          <tbody>
            <tr><td style="width: 180px; opacity: 0.7">app</td><td>{{ sys.app.name }} v{{ sys.app.version }}<NTag v-if="sys.app.dev" size="tiny" type="warning" style="margin-left: 8px">dev</NTag></td></tr>
            <tr><td style="opacity: 0.7">Node.js</td><td>{{ sys.node }}</td></tr>
            <tr><td style="opacity: 0.7">MKVToolNix</td><td>{{ sys.mkv.version || '—' }}</td></tr>
            <tr><td style="opacity: 0.7">fnOS</td><td>{{ sys.sys.version || '—' }} ({{ sys.sys.arch || '—' }})</td></tr>
          </tbody>
        </NTable>
      </NSpace>
    </NCard>

    <NCard :title="$t('about.license')">
      <NAlert type="info" :show-icon="false">{{ $t('about.licenseText') }}</NAlert>
    </NCard>

    <NCard :title="$t('about.links')">
      <ul style="line-height: 2; margin: 0; padding-left: 20px">
        <li><a href="https://mkvtoolnix.download/" target="_blank" rel="noreferrer">MKVToolNix 官方网站</a></li>
        <li><a href="https://mkvtoolnix.download/source.html" target="_blank" rel="noreferrer">MKVToolNix 源码（GPL-2.0）</a></li>
        <li><a href="https://gitlab.com/mbunkus/mkvtoolnix" target="_blank" rel="noreferrer">MKVToolNix 仓库 (GitLab)</a></li>
      </ul>
    </NCard>
  </NSpace>
</template>
